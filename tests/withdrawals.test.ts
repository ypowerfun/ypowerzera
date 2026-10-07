import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { PASSWORD, makeUser } from "./factories";
import { admin, balances, emailOf, fund, lastOtp, leaderWithWinnings, makeKycUser, makeLeader, newAdmin, nextCpf } from "./wallet-helpers";
import {
  adminResolveProcessing,
  authorizeTransfer,
  cancelWithdrawal,
  confirmWithdrawal,
  processDueWithdrawals,
  processWithdrawal,
  reconcileProcessing,
  requestWithdrawal,
  reviewWithdrawal,
} from "@/server/withdrawals";
import { handlePixWebhook, handleTransferAuthorization } from "@/server/pix-webhooks";
import { mockFinishTransfer, mockPix, mockTransferAuthRequest } from "@/server/pix/mock";
import { freezeWallet, reconcileAll, withdrawableBreakdown } from "@/server/wallet";
import { changePassword } from "@/server/auth";
import { setWithdrawalsNeedAdminApproval, withdrawalsNeedAdminApproval } from "@/server/settings";
import { signPayload } from "@/lib/signature";

const nonce = () => `nonce-${Math.random().toString(36).slice(2)}-${Date.now()}`;
beforeEach(async () => {
  await db.rateLimit.deleteMany();
  delete process.env.WITHDRAW_FEE_CENTS;
  delete process.env.PAYOUTS_PAUSED;
});

async function request(l: Awaited<ReturnType<typeof makeLeader>>, cents: number, extra: Partial<{ password: string; nonce: string }> = {}) {
  return requestWithdrawal(l.user, { teamId: l.team.id, amountCents: cents, password: extra.password ?? PASSWORD, nonce: extra.nonce ?? nonce() });
}

async function confirmed(l: Awaited<ReturnType<typeof makeLeader>>, cents: number) {
  const { withdrawalId } = await request(l, cents);
  const status = await confirmWithdrawal(l.user, withdrawalId, lastOtp(await emailOf(l.user)));
  return { id: withdrawalId, status };
}

/** Leva um saque até APPROVED (revisão do admin se necessário) e libera a janela de cancelamento. */
async function approved(l: Awaited<ReturnType<typeof makeLeader>>, cents: number) {
  const { id, status } = await confirmed(l, cents);
  if (status === "under_review") await reviewWithdrawal(await admin(), id, "approve", "Conferido pelo analista de risco");
  await db.withdrawal.update({ where: { id }, data: { processAfter: new Date(Date.now() - 1000) } });
  return id;
}

describe("pedido de saque", () => {
  it("sem ganhos não há o que sacar (depósito precisa de giro)", async () => {
    const l = await makeLeader();
    await fund(l, 20_000);
    await expect(request(l, 5_000)).rejects.toThrow(/Saldo sacável: R\$\s?0,00/);
  });

  it("só o líder com KYC verificado e senha correta; reenvio com o mesmo nonce não duplica", async () => {
    const { winner } = await leaderWithWinnings();
    const member = await makeKycUser();
    await db.teamMember.create({ data: { teamId: winner.team.id, userId: member.user.id, role: "PLAYER" } });
    await expect(requestWithdrawal(member.user, { teamId: winner.team.id, amountCents: 5_000, password: PASSWORD, nonce: nonce() })).rejects.toThrow(/líder/);
    const adm = await admin();
    await expect(requestWithdrawal(adm, { teamId: winner.team.id, amountCents: 5_000, password: PASSWORD, nonce: nonce() })).rejects.toThrow(/líder/);
    await expect(request(winner, 5_000, { password: "senha-errada-123" })).rejects.toThrow(/Senha incorreta/);
    const pending = await makeLeader({ approved: false });
    await expect(request(pending, 5_000)).rejects.toThrow(/análise|identidade/);

    const n = nonce();
    const before = await balances(winner.walletId);
    const a = await request(winner, 5_000, { nonce: n });
    const b = await request(winner, 5_000, { nonce: n });
    expect(b.withdrawalId).toBe(a.withdrawalId);
    const after = await balances(winner.walletId);
    expect(after.available).toBe(before.available - 5_000); // bloqueado uma única vez
    expect(after.locked).toBe(before.locked + 5_000);
    expect(await db.withdrawal.count({ where: { walletId: winner.walletId } })).toBe(1);
  });

  it("valida valor: créditos inteiros, mínimo, máximo e saldo", async () => {
    const { winner } = await leaderWithWinnings();
    await expect(request(winner, 5_050)).rejects.toThrow(/inteiros/);
    await expect(request(winner, 1_000)).rejects.toThrow(/mínimo/);
    await expect(request(winner, 300_000)).rejects.toThrow(/máximo/);
    const w = await withdrawableBreakdown(db, winner.walletId);
    await expect(request(winner, w.withdrawableCents + 100)).rejects.toThrow(/Saldo sacável/);
  });

  it("conta nova e troca recente de senha bloqueiam saques", async () => {
    const { winner } = await leaderWithWinnings();
    await db.user.update({ where: { id: winner.user.id }, data: { createdAt: new Date() } });
    await expect(request(winner, 5_000)).rejects.toThrow(/Contas novas/);
    await db.user.update({ where: { id: winner.user.id }, data: { createdAt: new Date(Date.now() - 10 * 86400_000) } });
    await changePassword(winner.user.id, PASSWORD, "OutraSenha#2027");
    await expect(requestWithdrawal(winner.user, { teamId: winner.team.id, amountCents: 5_000, password: "OutraSenha#2027", nonce: nonce() })).rejects.toThrow(/bloqueados/);
  });

  it("no máximo 2 saques aguardando código; depois, limite diário de quantidade e de valor", async () => {
    const { winner } = await leaderWithWinnings(300_000, 50_000);
    await request(winner, 2_000);
    await request(winner, 2_000);
    await expect(request(winner, 2_000)).rejects.toThrow(/Confirme ou cancele/);
    // confirmando, liberam-se os "pendentes de código", mas o limite diário de 3 saques continua valendo
    const open = await db.withdrawal.findMany({ where: { walletId: winner.walletId, status: "PENDING_CONFIRMATION" } });
    for (const w of open) await db.withdrawal.update({ where: { id: w.id }, data: { status: "UNDER_REVIEW" } });
    await request(winner, 2_000);
    await expect(request(winner, 2_000)).rejects.toThrow(/Limite diário de saques/);
  });

  it("limite diário de valor da equipe", async () => {
    const { winner } = await leaderWithWinnings();
    for (const cents of [250_000, 250_000]) {
      await db.withdrawal.create({
        data: { walletId: winner.walletId, teamId: winner.team.id, requestedById: winner.user.id, amountCents: cents, netCents: cents, status: "UNDER_REVIEW", destinationCpfLast4: "0000", requestNonce: nonce() },
      });
    }
    await expect(request(winner, 2_000)).rejects.toThrow(/Limite diário de valor/);
  });

  it("carteira congelada não saca; pausa global de saques", async () => {
    const { winner } = await leaderWithWinnings();
    process.env.PAYOUTS_PAUSED = "true";
    await expect(request(winner, 5_000)).rejects.toThrow(/pausados/);
    delete process.env.PAYOUTS_PAUSED;
    await freezeWallet(db, winner.walletId, "teste");
    await expect(request(winner, 5_000)).rejects.toThrow(/congelada/);
  });
});

describe("confirmação por código (OTP)", () => {
  it("código errado, excesso de tentativas cancela e devolve o saldo", async () => {
    const { winner } = await leaderWithWinnings();
    const before = await balances(winner.walletId);
    const { withdrawalId } = await request(winner, 5_000);
    for (let i = 0; i < 5; i++) await expect(confirmWithdrawal(winner.user, withdrawalId, "000000")).rejects.toThrow(/incorreto/);
    await expect(confirmWithdrawal(winner.user, withdrawalId, lastOtp(await emailOf(winner.user)))).rejects.toThrow(/cancelado/);
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } });
    expect(w.status).toBe("CANCELED");
    expect(await balances(winner.walletId)).toEqual(before);
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("código expirado cancela; só o solicitante confirma", async () => {
    const { winner } = await leaderWithWinnings();
    const before = await balances(winner.walletId);
    const { withdrawalId } = await request(winner, 5_000);
    const stranger = await makeKycUser();
    await expect(confirmWithdrawal(stranger.user, withdrawalId, lastOtp(await emailOf(winner.user)))).rejects.toThrow(/não encontrado/);
    await db.withdrawal.update({ where: { id: withdrawalId }, data: { otpExpiresAt: new Date(Date.now() - 1000) } });
    await expect(confirmWithdrawal(winner.user, withdrawalId, lastOtp(await emailOf(winner.user)))).rejects.toThrow(/expirou/);
    expect(await balances(winner.walletId)).toEqual(before);
  });

  it("o primeiro saque sempre vai para revisão manual", async () => {
    const { winner } = await leaderWithWinnings();
    const { id, status } = await confirmed(winner, 5_000);
    expect(status).toBe("under_review");
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(w.riskFlags as string[]).toContain("FIRST_WITHDRAWAL");
    expect(w.processAfter).toBeNull();
    expect(w.otpHash).toBeNull(); // código descartado
  });
});

describe("revisão, cancelamento e envio", () => {
  it("quatro olhos: solicitante/membro/não-admin não aprovam; admin aprova ou recusa", async () => {
    const { winner } = await leaderWithWinnings();
    const { id } = await confirmed(winner, 5_000);
    const stranger = await makeUser();
    await expect(reviewWithdrawal(stranger, id, "approve", "tentando aprovar")).rejects.toThrow(/administradores/);
    const insider = await newAdmin();
    await db.teamMember.create({ data: { teamId: winner.team.id, userId: insider.id, role: "PLAYER" } });
    await expect(reviewWithdrawal(insider, id, "approve", "sou da equipe")).rejects.toThrow(/Conflito/);
    // admin que é o próprio solicitante
    await db.user.update({ where: { id: winner.user.id }, data: { role: "ADMIN" } });
    await expect(reviewWithdrawal({ ...winner.user, role: "ADMIN" }, id, "approve", "aprovando o meu próprio")).rejects.toThrow(/Conflito/);
    await db.user.update({ where: { id: winner.user.id }, data: { role: "USER" } });
    await expect(reviewWithdrawal(await admin(), id, "approve", "ok")).rejects.toThrow(/5 caracteres/);

    const before = await balances(winner.walletId);
    await reviewWithdrawal(await admin(), id, "reject", "Atividade suspeita na conta");
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(w.status).toBe("REJECTED");
    const after = await balances(winner.walletId);
    expect(after.available).toBe(before.available + 5_000);
    expect(after.locked).toBe(before.locked - 5_000);
    await expect(reviewWithdrawal(await admin(), id, "approve", "tarde demais para isso")).rejects.toThrow(/não está em análise/);
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("não envia antes do prazo; depois envia uma única vez e conclui por webhook assinado", async () => {
    const { winner } = await leaderWithWinnings();
    const { id, status } = await confirmed(winner, 5_000);
    expect(status).toBe("under_review");
    await reviewWithdrawal(await admin(), id, "approve", "Conferido pelo analista de risco");
    const approvedRow = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(approvedRow.status).toBe("APPROVED");
    expect(approvedRow.processAfter!.getTime()).toBeGreaterThan(Date.now());
    expect(await processDueWithdrawals()).toEqual({ processed: 0, skipped: 0 });
    await db.withdrawal.update({ where: { id }, data: { processAfter: new Date(Date.now() - 1000) } });

    // dois processadores concorrentes: apenas um envia
    const out = await Promise.all([processWithdrawal(id), processWithdrawal(id), processWithdrawal(id)]);
    expect(out.filter((x) => x === "sent").length).toBe(1);
    expect(await db.mockPixTransfer.count({ where: { externalReference: id } })).toBe(1);
    const sent = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(sent.status).toBe("PROCESSING");
    expect(sent.providerTransferId).toBeTruthy();
    // o dinheiro continua bloqueado até o banco confirmar
    expect((await balances(winner.walletId)).locked).toBe(5_000);

    const hook = await mockFinishTransfer(sent.providerTransferId!, true);
    expect((await handlePixWebhook(hook.headers, hook.rawBody)).status).toBe(200);
    await handlePixWebhook(hook.headers, hook.rawBody); // reentrega
    const paid = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(paid.status).toBe("PAID");
    expect(paid.endToEndId).toMatch(/^E/);
    expect((await balances(winner.walletId)).locked).toBe(0);
    expect(await db.ledgerEntry.count({ where: { refId: id, type: "WITHDRAWAL_PAID" } })).toBe(1);
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("a transferência é feita para o CPF do titular (nunca para outro destino)", async () => {
    const { winner } = await leaderWithWinnings();
    const id = await approved(winner, 5_000);
    await processWithdrawal(id);
    const t = await db.mockPixTransfer.findUniqueOrThrow({ where: { externalReference: id } });
    expect(t.pixKey).toBe(winner.cpf.replace(/\D/g, ""));
    expect(t.amountCents).toBe(5_000);
  });

  it("falha na transferência devolve o saldo", async () => {
    const { winner } = await leaderWithWinnings();
    const before = await balances(winner.walletId);
    const id = await approved(winner, 5_000);
    await processWithdrawal(id);
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    const hook = await mockFinishTransfer(w.providerTransferId!, false);
    await handlePixWebhook(hook.headers, hook.rawBody);
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
    expect(await balances(winner.walletId)).toEqual(before);
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("resposta ambígua do provedor: não reenvia nem devolve o saldo (conciliação manual)", async () => {
    const { winner } = await leaderWithWinnings();
    const id = await approved(winner, 5_000);
    const spy = vi.spyOn(mockPix, "sendPix").mockRejectedValueOnce(new Error("timeout de rede"));
    expect(await processWithdrawal(id)).toBe("needs_reconciliation");
    spy.mockRestore();
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(w.status).toBe("PROCESSING");
    expect((await balances(winner.walletId)).locked).toBe(5_000);
    // nenhum job reenvia automaticamente
    expect(await processWithdrawal(id)).toBe("skipped");
    expect(await db.mockPixTransfer.count({ where: { externalReference: id } })).toBe(0);
    // só admin sem conflito resolve, informando o que conferiu
    await expect(adminResolveProcessing(winner.user, id, "failed", "conferi no banco e não saiu")).rejects.toThrow(/administradores/);
    await adminResolveProcessing(await admin(), id, "failed", "Conferido no painel do banco: transferência não saiu");
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("reconcileProcessing fecha saques presos consultando o provedor", async () => {
    const { winner } = await leaderWithWinnings();
    const id = await approved(winner, 5_000);
    await processWithdrawal(id);
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    await mockFinishTransfer(w.providerTransferId!, true); // banco confirmou, mas o webhook se perdeu
    // updatedAt é gerenciado pelo Prisma (o SQLite guarda DateTime em milissegundos): envelhece via SQL
    await db.$executeRawUnsafe(`UPDATE "Withdrawal" SET "updatedAt" = ? WHERE id = ?`, Date.now() - 3600_000, id);
    expect((await reconcileProcessing(10)).resolved).toBe(1);
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id } })).status).toBe("PAID");
  });

  it("cancelar: líder cancela até ser enviado; depois não; terceiros nunca", async () => {
    const { winner } = await leaderWithWinnings();
    const before = await balances(winner.walletId);
    const { id } = await confirmed(winner, 5_000);
    const stranger = await makeKycUser();
    await expect(cancelWithdrawal(stranger.user, id)).rejects.toThrow(/líder|permiss/i);
    await cancelWithdrawal(winner.user, id);
    expect(await balances(winner.walletId)).toEqual(before);
    await expect(cancelWithdrawal(winner.user, id)).rejects.toThrow(/não pode mais/);

    const id2 = await approved(winner, 5_000);
    await processWithdrawal(id2);
    await expect(cancelWithdrawal(winner.user, id2)).rejects.toThrow(/não pode mais/);
  });

  it("revalidação no último instante: carteira congelada ou senha trocada volta para análise", async () => {
    const { winner } = await leaderWithWinnings();
    const id = await approved(winner, 5_000);
    await freezeWallet(db, winner.walletId, "anomalia detectada");
    expect(await processWithdrawal(id)).toBe("skipped");
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(w.status).toBe("UNDER_REVIEW");
    expect(w.failureReason).toMatch(/congelada/);
    expect(await db.mockPixTransfer.count({ where: { externalReference: id } })).toBe(0);
  });

  it("por padrão TODO saque exige a liberação do admin, até o pequeno e sem risco", async () => {
    expect(await withdrawalsNeedAdminApproval()).toBe(true);
    const { winner } = await leaderWithWinnings(300_000, 50_000);
    const small = await confirmed(winner, 2_000);
    expect(small.status).toBe("under_review");
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id: small.id } });
    expect(w.status).toBe("UNDER_REVIEW");
    expect(w.processAfter).toBeNull(); // sem aprovação do admin não há envio agendado
    await reviewWithdrawal(await admin(), small.id, "approve", "Conferi o titular e o histórico");
    const after = await db.withdrawal.findUniqueOrThrow({ where: { id: small.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.processAfter!.getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);
  });

  it("saque seguinte, pequeno e limpo, é aprovado automaticamente (com atraso) quando o admin desliga a exigência", async () => {
    await setWithdrawalsNeedAdminApproval(await admin(), false);
    try {
    const { winner } = await leaderWithWinnings(300_000, 50_000);
    const first = await approved(winner, 5_000);
    await processWithdrawal(first);
    const t = await db.withdrawal.findUniqueOrThrow({ where: { id: first } });
    await handlePixWebhook(...Object.values(await mockFinishTransfer(t.providerTransferId!, true)).reverse() as [Headers, string]);
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id: first } })).status).toBe("PAID");
    const { id, status } = await confirmed(winner, 5_000);
    expect(status).toBe("approved");
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(w.status).toBe("APPROVED");
    expect(w.processAfter!.getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);
    // valor acima do limite automático volta a exigir revisão
    const big = await confirmed(winner, 60_000);
    expect(big.status).toBe("under_review");
    } finally {
      await setWithdrawalsNeedAdminApproval(await admin(), true);
    }
  });

  it("tarifa de saque preserva a conservação do dinheiro", async () => {
    process.env.WITHDRAW_FEE_CENTS = "500";
    const { winner } = await leaderWithWinnings();
    const id = await approved(winner, 5_000);
    await processWithdrawal(id);
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    expect(w.netCents).toBe(4_500);
    expect((await db.mockPixTransfer.findUniqueOrThrow({ where: { externalReference: id } })).amountCents).toBe(4_500);
    const hook = await mockFinishTransfer(w.providerTransferId!, true);
    await handlePixWebhook(hook.headers, hook.rawBody);
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id } })).status).toBe("PAID");
    const platform = await db.wallet.findUniqueOrThrow({ where: { id: "platform" } });
    expect(platform.balanceCents).toBeGreaterThanOrEqual(500);
    const r = await reconcileAll();
    expect(r.ok, r.mismatches.join("; ")).toBe(true);
  });
});

describe("autorização de transferência (proteção contra chave de API vazada)", () => {
  async function processing() {
    const { winner } = await leaderWithWinnings();
    const id = await approved(winner, 5_000);
    await processWithdrawal(id);
    return { winner, id, w: await db.withdrawal.findUniqueOrThrow({ where: { id } }) };
  }

  it("aprova exatamente a transferência do saque em processamento", async () => {
    const { winner, id, w } = await processing();
    const req = mockTransferAuthRequest({ transferId: w.providerTransferId!, externalReference: id, amountCents: 5_000, pixKey: winner.cpf });
    const res = await handleTransferAuthorization(req.headers, req.rawBody);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ approved: true });
  });

  it("recusa valor diferente, chave de terceiro, saque inexistente e estado errado", async () => {
    const { winner, id } = await processing();
    const refused = async (args: Parameters<typeof mockTransferAuthRequest>[0]) => {
      const r = mockTransferAuthRequest(args);
      const out = await handleTransferAuthorization(r.headers, r.rawBody);
      return out.body as { approved: boolean; reason: string };
    };
    expect(await refused({ externalReference: id, amountCents: 50_000, pixKey: winner.cpf })).toMatchObject({ approved: false, reason: expect.stringMatching(/valor/) });
    expect(await refused({ externalReference: id, amountCents: 5_000, pixKey: nextCpf() })).toMatchObject({ approved: false, reason: expect.stringMatching(/titular/) });
    expect(await refused({ externalReference: "inventado", amountCents: 5_000, pixKey: winner.cpf })).toMatchObject({ approved: false, reason: expect.stringMatching(/não originada/) });
    // saque já pago deixa de ser autorizável
    const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
    const hook = await mockFinishTransfer(w.providerTransferId!, true);
    await handlePixWebhook(hook.headers, hook.rawBody);
    expect(await refused({ externalReference: id, amountCents: 5_000, pixKey: winner.cpf })).toMatchObject({ approved: false, reason: expect.stringMatching(/PAID/) });
    expect(await db.auditLog.count({ where: { action: "security.transfer_refused" } })).toBeGreaterThanOrEqual(3);
  });

  it("assinatura inválida ou carteira congelada/saques pausados → recusa", async () => {
    const { winner, id } = await processing();
    const body = JSON.stringify({ externalReference: id, amountCents: 5_000, pixKey: winner.cpf });
    expect((await handleTransferAuthorization(new Headers({ "x-mock-signature": signPayload(body, "errado") }), body)).status).toBe(401);
    expect((await authorizeTransfer({ externalReference: id, amountCents: 5_000, pixKey: winner.cpf })).approved).toBe(true);
    await freezeWallet(db, winner.walletId, "x");
    expect((await authorizeTransfer({ externalReference: id, amountCents: 5_000, pixKey: winner.cpf })).approved).toBe(false);
    process.env.PAYOUTS_PAUSED = "true";
    expect((await authorizeTransfer({ externalReference: id, amountCents: 5_000, pixKey: winner.cpf })).reason).toMatch(/pausados/);
  });
});
