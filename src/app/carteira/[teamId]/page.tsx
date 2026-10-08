import { flatParams, safeHttpUrl } from "@/lib/url";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelWithdrawalAction, confirmWithdrawalAction, createDepositAction, newNonce, requestWithdrawalAction } from "@/app/actions/wallet";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Alert, Badge, ButtonLink, Card, Empty, Field, Input, PageTitle, Stat, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getKyc } from "@/server/kyc";
import { moneyConfig } from "@/server/money-config";
import { requireUser } from "@/server/session";
import { isWalletOn } from "@/server/settings";
import { WalletUnavailable } from "@/components/wallet-off";
import { getOrCreateTeamWallet, withdrawableBreakdown } from "@/server/wallet";
import { MANUAL_PAYOUT } from "@/server/withdrawals";

export const metadata: Metadata = { title: "Carteira da equipe", robots: { index: false } };
export const dynamic = "force-dynamic";

const depTone = { PENDING: "warn", CONFIRMED: "ok", HELD: "danger", FAILED: "danger", EXPIRED: "neutral", REVERSED: "danger", REFUNDED: "accent" } as const;
const depLabel = { PENDING: "Aguardando Pix", CONFIRMED: "Creditado", HELD: "Em análise", FAILED: "Falhou", EXPIRED: "Expirado", REVERSED: "Estornado", REFUNDED: "Devolvido" } as const;
const wdTone = { PENDING_CONFIRMATION: "warn", UNDER_REVIEW: "warn", APPROVED: "brand", PROCESSING: "brand", PAID: "ok", REJECTED: "danger", CANCELED: "neutral", FAILED: "danger" } as const;
const wdLabel = { PENDING_CONFIRMATION: "Aguardando código", UNDER_REVIEW: "Em análise de segurança", APPROVED: "Aprovado (envio em breve)", PROCESSING: "Enviando por Pix", PAID: "Pago", REJECTED: "Recusado", CANCELED: "Cancelado", FAILED: "Falhou (valor devolvido)" } as const;
const ledgerLabel: Record<string, string> = { DEPOSIT: "Depósito", DEPOSIT_REVERSAL: "Estorno de depósito", WITHDRAWAL_HOLD: "Saque solicitado", WITHDRAWAL_RELEASE: "Saque devolvido", WITHDRAWAL_PAID: "Saque pago", STAKE_LOCK: "Aposta em custódia", STAKE_REFUND: "Aposta devolvida", STAKE_LOSS: "Desafio perdido", STAKE_RETURN: "Aposta recuperada", PRIZE_WIN: "Prêmio de desafio", FEE: "Taxa", ADJUSTMENT: "Ajuste" };

export default async function TeamWalletPage({ params, searchParams }: { params: Promise<{ teamId: string }>; searchParams: Promise<{ pix?: string; confirmar?: string; saque?: string }> }) {
  const { teamId } = await params;
  const sp = flatParams(await searchParams);
  const user = await requireUser(`/carteira/${teamId}`);
  if (!(await isWalletOn())) return <WalletUnavailable />;
  const team = await db.team.findUnique({ where: { id: teamId }, include: { members: true } });
  if (!team) notFound();
  const me = team.members.find((m) => m.userId === user.id);
  if (me?.role !== "CAPTAIN") {
    return (
      <div className="mx-auto max-w-lg"><Alert tone="warn"><b>Somente o líder da equipe</b> pode ver e movimentar a carteira de [{team.tag}] {team.name}. <Link href="/carteira" className="underline">Voltar</Link></Alert></div>
    );
  }
  const deleted = !!team.deletedAt;
  if (deleted && !team.balanceReleasedAt) {
    return (
      <div className="mx-auto max-w-lg"><Alert tone="warn"><b>[{team.tag}] {team.name} foi excluída</b> e o saldo está bloqueado até a revisão do administrador. <Link href="/carteira" className="underline">Peça a revisão na Carteira</Link>.</Alert></div>
    );
  }
  const cfg = moneyConfig();
  const wallet = await getOrCreateTeamWallet(db, team.id);
  const [kyc, b, deposits, withdrawals, ledger] = await Promise.all([
    getKyc(user.id),
    withdrawableBreakdown(db, wallet.id),
    db.deposit.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.withdrawal.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.ledgerEntry.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  const pixDeposit = sp.pix ? deposits.find((d) => d.id === sp.pix) : undefined;
  const stripeUrl = pixDeposit?.provider === "stripe" ? safeHttpUrl(pixDeposit.pixCopyPaste) : null;
  const confirming = sp.confirmar ? withdrawals.find((w) => w.id === sp.confirmar && w.status === "PENDING_CONFIRMATION") : undefined;
  const canDeposit = !!kyc && kyc.status !== "REJECTED";
  const canWithdraw = kyc?.status === "VERIFIED";
  const hasWithdrawable = b.withdrawableCents >= cfg.withdrawMinCents;
  const nonce = await newNonce();
  const dev = getEnv().pixProvider === "mock" && !getEnv().isProd;
  const manualPayouts = getEnv().pixProvider === "stripe"; // o Stripe não paga Pix a terceiros: o administrador faz o Pix do saque

  return (
    <div className="space-y-6">
      <PageTitle title={`Carteira · [${team.tag}] ${team.name}`} subtitle={deleted ? "Equipe excluída: o administrador liberou o saldo para saque." : "Você é o líder desta equipe: só você movimenta estes créditos."} actions={<>{!deleted && <ButtonLink href="/desafios/novo" variant="accent">Criar desafio</ButtonLink>}<ButtonLink href="/carteira" variant="secondary">Todas as equipes</ButtonLink></>} />

      {deleted && <Alert tone="ok"><b>Saldo liberado.</b> Esta equipe foi excluída, então não recebe depósitos nem entra em desafios; o saldo abaixo pode ser sacado para o CPF verificado do líder.</Alert>}

      {wallet.frozenAt && <Alert tone="danger"><b>Carteira congelada</b> para análise de segurança ({wallet.frozenReason}). Depósitos recebidos continuam sendo registrados, mas saques e novos desafios estão bloqueados. Fale com o suporte.</Alert>}
      {wallet.debtCents > 0 && <Alert tone="danger">Há uma dívida de {formatMoney(wallet.debtCents)} por estorno de depósito. Regularize com o suporte.</Alert>}
      {!canDeposit && <Alert tone="warn" className="flex flex-wrap items-center justify-between gap-3"><span>Envie seus dados de identidade para depositar.</span><ButtonLink href="/carteira/verificacao" variant="secondary">Verificar identidade</ButtonLink></Alert>}
      {sp.saque === "approved" && <Alert tone="ok">{manualPayouts ? "Saque confirmado! Nossa equipe fará o Pix para o seu CPF depois de alguns minutos (você pode cancelar até lá)." : "Saque confirmado! Será enviado por Pix em alguns minutos (você pode cancelar até lá)."}</Alert>}
      {sp.saque === "under_review" && <Alert tone="warn">Saque confirmado e enviado para <b>análise de segurança</b>. Avisaremos quando for decidido.</Alert>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Saldo disponível" value={formatMoney(b.balanceCents)} tone="ok" hint="Pode apostar em desafios" />
        <Stat label="Em custódia" value={formatMoney(b.lockedCents)} hint="Apostas abertas e saques em andamento" />
        <Stat label="Sacável agora" value={formatMoney(b.withdrawableCents)} tone="brand" hint="Só o que foi ganho e já liberado" />
        <Stat label="Retido por segurança" value={formatMoney(Math.max(0, b.balanceCents - b.withdrawableCents))} tone="warn" hint="Depósito sem giro / recente / prêmio < 24h" />
      </section>

      <div className={`grid items-start gap-6 ${deleted ? "" : "lg:grid-cols-2"}`}>
        {!deleted && <Card>
          <h2 className="mb-1 font-bold">Depositar via Pix</h2>
          <p className="mb-4 text-sm text-muted">1 crédito = R$ 1,00. Entre {formatMoney(cfg.depositMinCents)} e {formatMoney(cfg.depositMaxCents)} por Pix. O Pix precisa ser pago com o <b>seu CPF</b>.</p>
          {pixDeposit && pixDeposit.status === "PENDING" && (
            <div className="mb-4 space-y-3 rounded-lg border border-brand/40 bg-brand/5 p-4">
              <meta httpEquiv="refresh" content="6" />
              <p className="text-sm font-semibold">Pague {formatMoney(pixDeposit.amountCents)} no Pix até {formatDateTime(pixDeposit.expiresAt)}</p>
              {pixDeposit.provider === "stripe" ? (
                // No Stripe o QR Code fica na página hospedada por ele: o endereço dela está guardado onde ficaria o copia-e-cola.
                stripeUrl ? (
                  <div className="space-y-2">
                    <ButtonLink href={stripeUrl} target="_blank" rel="noopener noreferrer" variant="accent">Pagar com Pix</ButtonLink>
                    <p className="text-xs text-muted">Abre a página segura do Stripe, com o QR Code e o copia-e-cola. Se pedirem o CPF, informe o <b>seu</b> (titular da conta): Pix pago por outra pessoa fica retido para análise.</p>
                  </div>
                ) : <p className="text-sm text-danger">Não foi possível abrir a página de pagamento. Gere um novo Pix.</p>
              ) : (
                <>
                  {pixDeposit.pixQrImage && /^[A-Za-z0-9+/=]+$/.test(pixDeposit.pixQrImage) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`data:image/png;base64,${pixDeposit.pixQrImage}`} alt="QR Code Pix" className="mx-auto h-44 w-44 rounded-lg bg-white p-2" />
                  )}
                  <div className="flex gap-2"><Input readOnly value={pixDeposit.pixCopyPaste ?? ""} aria-label="Pix copia e cola" className="font-mono text-xs" /><CopyButton text={pixDeposit.pixCopyPaste ?? ""} label="Copiar Pix" /></div>
                </>
              )}
              <p className="text-xs text-muted">Esta página atualiza sozinha quando o pagamento for confirmado.</p>
              {dev && <Link href="/dev/pix" className="text-xs text-warn underline">[dev] simular o pagamento deste Pix</Link>}
            </div>
          )}
          {pixDeposit && pixDeposit.status === "CONFIRMED" && <Alert tone="ok" className="mb-4">Pix confirmado! {formatMoney(pixDeposit.amountCents)} creditados.</Alert>}
          {pixDeposit && pixDeposit.status === "HELD" && <Alert tone="warn" className="mb-4">Recebemos o Pix, mas ele está em análise: {pixDeposit.holdReason}</Alert>}
          <ActionForm action={createDepositAction} className="space-y-3" submit="Gerar Pix" submitClassName="" >
            <input type="hidden" name="teamId" value={team.id} />
            <Field label="Valor em créditos" htmlFor="dep-credits"><Input id="dep-credits" name="credits" type="number" min={cfg.depositMinCents / 100} max={cfg.depositMaxCents / 100} step={1} required disabled={!canDeposit} /></Field>
          </ActionForm>
        </Card>}

        <Card>
          <h2 className="mb-1 font-bold">Sacar por Pix</h2>
          <p className="mb-4 text-sm text-muted">O valor é enviado <b>somente</b> para a chave Pix do seu CPF verificado (final {kyc?.cpfLast4 ?? "—"}). Mín. {formatMoney(cfg.withdrawMinCents)} · máx. {formatMoney(cfg.withdrawMaxCents)} por pedido.</p>
          {!canWithdraw && <Alert tone="warn" className="mb-4">Saques exigem identidade <b>verificada</b>{kyc?.status === "PENDING" ? " (sua análise está em andamento)" : ""}.</Alert>}
          {confirming && (
            <div className="mb-4 space-y-3 rounded-lg border border-warn/40 bg-warn/5 p-4">
              <p className="text-sm font-semibold">Confirme o saque de {formatMoney(confirming.amountCents)}</p>
              <p className="text-xs text-muted">Enviamos um código de 6 dígitos para o seu e-mail. Os créditos já estão bloqueados e voltam ao saldo se você cancelar ou o código expirar.</p>
              <ActionForm action={confirmWithdrawalAction} className="space-y-3" submit="Confirmar saque" submitClassName="">
                <input type="hidden" name="withdrawalId" value={confirming.id} />
                <input type="hidden" name="teamId" value={team.id} />
                <Field label="Código de 6 dígitos" htmlFor="code"><Input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" className="max-w-40 text-center font-mono text-lg tracking-[0.4em]" /></Field>
              </ActionForm>
            </div>
          )}
          <ActionForm action={requestWithdrawalAction} className="space-y-3" submit="Solicitar saque" submitClassName="">
            <input type="hidden" name="teamId" value={team.id} />
            <input type="hidden" name="nonce" value={nonce} />
            <Field label={`Valor em créditos (sacável: ${formatMoney(b.withdrawableCents)})`} htmlFor="wd-credits"><Input id="wd-credits" name="credits" type="number" min={cfg.withdrawMinCents / 100} max={Math.min(cfg.withdrawMaxCents, Math.max(b.withdrawableCents, cfg.withdrawMinCents)) / 100} step={1} required disabled={!canWithdraw || !hasWithdrawable} /></Field>
            <Field label="Confirme sua senha" htmlFor="wd-pass"><Input id="wd-pass" name="password" type="password" autoComplete="current-password" required disabled={!canWithdraw || !hasWithdrawable} /></Field>
          </ActionForm>
          {canWithdraw && !hasWithdrawable && <p className="mt-3 text-sm text-warn">Nada sacável agora. O depósito precisa ser jogado em desafios antes de sair, e depósitos e prêmios recentes ficam retidos por segurança.</p>}
          {manualPayouts && <p className="mt-3 text-sm text-muted">Os saques são pagos <b>manualmente</b> pela nossa equipe: o Pix pode levar algumas horas depois da aprovação.</p>}
          <p className="mt-3 text-xs text-muted">Segurança: senha + código por e-mail, retenção de depósitos recentes ({cfg.depositHoldHours}h) e prêmios ({cfg.winHoldHours}h), giro obrigatório do depósito, revisão humana de saques de risco e envio com atraso de {cfg.withdrawDelayMinutes} min para você poder cancelar.</p>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 font-bold">Saques</h2>
        {withdrawals.length === 0 ? <Empty title="Nenhum saque ainda" /> : (
          <Table>
            <thead><tr><Th>Data</Th><Th>Valor</Th><Th>Destino</Th><Th>Situação</Th><Th /></tr></thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w.id}>
                  <Td className="text-muted">{formatDateTime(w.createdAt)}</Td>
                  <Td className="font-semibold">{formatMoney(w.amountCents)}{w.feeCents > 0 && <span className="block text-xs text-muted">líquido {formatMoney(w.netCents)}</span>}</Td>
                  <Td className="text-muted">Pix CPF •••{w.destinationCpfLast4}</Td>
                  <Td><Badge tone={wdTone[w.status]}>{w.status === "PROCESSING" && w.provider === MANUAL_PAYOUT ? "Aguardando pagamento pelo administrador" : wdLabel[w.status]}</Badge>{w.reviewNote && <span className="block text-xs text-muted">{w.reviewNote}</span>}</Td>
                  <Td>
                    {w.status === "PENDING_CONFIRMATION" && <Link href={`/carteira/${team.id}?confirmar=${w.id}`} className="mr-3 text-xs text-brand-soft hover:underline">informar código</Link>}
                    {["PENDING_CONFIRMATION", "UNDER_REVIEW", "APPROVED"].includes(w.status) && (
                      <ActionForm action={cancelWithdrawalAction} className="inline" submit="Cancelar" submitVariant="ghost" submitClassName="px-2 py-1 text-xs text-danger" confirm="Cancelar este saque?"><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="teamId" value={team.id} /></ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-bold">Depósitos</h2>
        {deposits.length === 0 ? <Empty title="Nenhum depósito ainda" /> : (
          <Table>
            <thead><tr><Th>Data</Th><Th>Valor</Th><Th>Situação</Th><Th /></tr></thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id}>
                  <Td className="text-muted">{formatDateTime(d.createdAt)}</Td>
                  <Td className="font-semibold">{formatMoney(d.amountCents)}</Td>
                  <Td><Badge tone={depTone[d.status]}>{depLabel[d.status]}</Badge>{d.holdReason && <span className="block text-xs text-muted">{d.holdReason}</span>}</Td>
                  <Td>{d.status === "PENDING" && <Link href={`/carteira/${team.id}?pix=${d.id}`} className="text-xs text-brand-soft hover:underline">ver Pix</Link>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-bold">Extrato</h2>
        {ledger.length === 0 ? <Empty title="Sem movimentações" /> : (
          <Table tableClassName="min-w-0 sm:min-w-[32rem]">
            <thead><tr><Th>Data</Th><Th>Movimento</Th><Th className="text-right">Disp.</Th><Th className="hidden text-right sm:table-cell">Custódia</Th><Th className="text-right">Saldo</Th></tr></thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</Td>
                  <Td>{ledgerLabel[e.type] ?? e.type}{e.memo && <span className="block text-xs text-muted">{e.memo}</span>}</Td>
                  <Td className={`text-right tabular-nums ${e.availableDeltaCents > 0 ? "text-ok" : e.availableDeltaCents < 0 ? "text-danger" : "text-muted"}`}>{e.availableDeltaCents ? formatMoney(e.availableDeltaCents) : "—"}</Td>
                  <Td className="hidden text-right tabular-nums text-muted sm:table-cell">{e.lockedDeltaCents ? formatMoney(e.lockedDeltaCents) : "—"}</Td>
                  <Td className="text-right font-semibold tabular-nums">{formatMoney(e.balanceAfterCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
