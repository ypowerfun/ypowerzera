import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { PASSWORD } from "./factories";
import { balances, emailOf, lastOtp, leaderWithWinnings } from "./wallet-helpers";

// O envio real é trocado por um que dá para fazer falhar; o resto do módulo de e-mail é o de verdade.
vi.mock("@/server/mailer", async () => {
  const actual = await vi.importActual<typeof import("@/server/mailer")>("@/server/mailer");
  return { ...actual, sendMail: vi.fn(actual.sendMail) };
});

import { sendMail } from "@/server/mailer";
import { confirmWithdrawal, requestWithdrawal } from "@/server/withdrawals";

const mailMock = vi.mocked(sendMail);
const nonce = () => `n-${Math.random().toString(36).slice(2)}-${Date.now()}`;

beforeEach(async () => {
  await db.rateLimit.deleteMany();
  mailMock.mockClear();
});

describe("saque com o SMTP fora do ar", () => {
  it("se o código não pode ser enviado, o saque é cancelado e o saldo volta na hora", async () => {
    const { winner } = await leaderWithWinnings();
    const before = await balances(winner.walletId);
    mailMock.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:587"));
    await expect(requestWithdrawal(winner.user, { teamId: winner.team.id, amountCents: 5_000, password: PASSWORD, nonce: nonce() })).rejects.toThrow(/não foi possível enviar o código/i);
    const w = await db.withdrawal.findFirstOrThrow({ where: { teamId: winner.team.id }, orderBy: { createdAt: "desc" } });
    expect(w.status).toBe("CANCELED");
    expect(await balances(winner.walletId)).toEqual(before); // nada ficou preso em custódia
    // com o SMTP de volta o pedido funciona
    const { withdrawalId } = await requestWithdrawal(winner.user, { teamId: winner.team.id, amountCents: 5_000, password: PASSWORD, nonce: nonce() });
    expect(withdrawalId).toBeTruthy();
  });

  it("se o aviso da confirmação falha, o saque continua confirmado e a pessoa não vê erro", async () => {
    const { winner } = await leaderWithWinnings();
    const { withdrawalId } = await requestWithdrawal(winner.user, { teamId: winner.team.id, amountCents: 5_000, password: PASSWORD, nonce: nonce() });
    const code = lastOtp(await emailOf(winner.user));
    mailMock.mockRejectedValueOnce(new Error("Connection timeout"));
    const status = await confirmWithdrawal(winner.user, withdrawalId, code);
    expect(["approved", "under_review"]).toContain(status);
    expect(["APPROVED", "UNDER_REVIEW"]).toContain((await db.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } })).status);
  });
});
