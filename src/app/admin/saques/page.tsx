import type { Metadata } from "next";
import { resolveProcessingAction, revealPayoutKeyAction, reviewWithdrawalAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, Empty, Input, PageTitle } from "@/components/ui";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { RISK_LABELS, type RiskFlag } from "@/server/risk";
import { requireAdmin } from "@/server/session";
import { MANUAL_PAYOUT, notManualPayout } from "@/server/withdrawals";

export const metadata: Metadata = { title: "Admin · Saques", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminWithdrawals() {
  await requireAdmin(); // o layout sozinho não basta: uma navegação parcial (RSC) pula o layout e a página consultaria o banco sem guarda
  const [review, manual, stuck] = await Promise.all([
    db.withdrawal.findMany({ where: { status: "UNDER_REVIEW" }, orderBy: { createdAt: "asc" } }),
    db.withdrawal.findMany({ where: { status: "PROCESSING", provider: MANUAL_PAYOUT }, orderBy: { createdAt: "asc" } }),
    db.withdrawal.findMany({ where: { status: "PROCESSING", ...notManualPayout, updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } }, orderBy: { createdAt: "asc" } }),
  ]);
  const ids = [...review, ...manual, ...stuck];
  const teams = await db.team.findMany({ where: { id: { in: ids.map((w) => w.teamId) } } });
  const users = await db.user.findMany({ where: { id: { in: ids.map((w) => w.requestedById) } }, select: { id: true, username: true, email: true, createdAt: true } });
  // o nome do titular (KYC verificado) é o que o banco mostra ao confirmar a chave Pix; o CPF em si só aparece depois do clique em "Mostrar chave Pix"
  const holders = await db.kycProfile.findMany({ where: { userId: { in: manual.map((w) => w.requestedById) } }, select: { userId: true, fullName: true } });
  const t = (id: string) => teams.find((x) => x.id === id);
  const u = (id: string) => users.find((x) => x.id === id);
  return (
    <div className="space-y-8">
      <PageTitle title="Saques" subtitle="Quatro olhos: você não pode decidir saque do qual é solicitante ou membro da equipe." />
      <section className="space-y-4">
        <h2 className="font-bold">Em análise de risco ({review.length})</h2>
        {review.length === 0 ? <Empty title="Nada para analisar" /> : review.map((w) => (
          <Card key={w.id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><p className="text-xl font-black">{formatMoney(w.amountCents)} <span className="text-sm font-normal text-muted">→ Pix CPF •••{w.destinationCpfLast4}</span></p><p className="text-xs text-muted">Equipe [{t(w.teamId)?.tag}] {t(w.teamId)?.name} · solicitante @{u(w.requestedById)?.username} ({u(w.requestedById)?.email}) · {formatDateTime(w.createdAt)}</p></div>
              <Badge tone={w.riskScore >= 80 ? "danger" : "warn"}>risco {w.riskScore}</Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">{((w.riskFlags as RiskFlag[] | null) ?? []).map((f) => <Badge key={f} tone="warn">{RISK_LABELS[f] ?? f}</Badge>)}{!((w.riskFlags as unknown[] | null)?.length) && <Badge>sem sinais — acima do limite automático</Badge>}</div>
            {w.failureReason && <Alert tone="warn">{w.failureReason}</Alert>}
            <div className="flex flex-wrap items-end gap-3">
              <ActionForm action={reviewWithdrawalAction} className="flex flex-wrap items-end gap-2" submit="Aprovar" submitClassName=""><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="decision" value="approve" /><Input name="note" required minLength={5} placeholder="O que foi verificado" className="w-72" /></ActionForm>
              <ActionForm action={reviewWithdrawalAction} className="flex flex-wrap items-end gap-2" submit="Recusar" submitVariant="danger" submitClassName=""><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="decision" value="reject" /><Input name="note" required minLength={5} placeholder="Motivo" className="w-60" /></ActionForm>
            </div>
          </Card>
        ))}
      </section>
      {(manual.length > 0 || getEnv().pixProvider === "stripe") && (
        <section className="space-y-4">
          <h2 className="font-bold">Para pagar à mão no banco ({manual.length})</h2>
          <p className="text-sm text-muted">O Stripe não paga Pix a terceiros. Clique em “Mostrar chave Pix” (fica registrado na auditoria), faça o Pix do valor líquido no app do seu banco para o CPF do titular e só então confirme aqui. Se não for pagar, devolva o valor ao saldo da equipe.</p>
          {manual.length === 0 ? <Empty title="Nenhum saque para pagar" /> : manual.map((w) => (
            <Card key={w.id} className="space-y-3">
              <div>
                <p className="text-xl font-black">{formatMoney(w.netCents)} <span className="text-sm font-normal text-muted">a pagar por Pix → CPF •••{w.destinationCpfLast4}</span></p>
                <p className="text-xs text-muted">Titular verificado: {holders.find((h) => h.userId === w.requestedById)?.fullName ?? "—"} · equipe [{t(w.teamId)?.tag}] {t(w.teamId)?.name} · solicitante @{u(w.requestedById)?.username} · pedido {formatDateTime(w.createdAt)}{w.feeCents > 0 && <> · tarifa de {formatMoney(w.feeCents)} já descontada</>}</p>
              </div>
              <ActionForm action={revealPayoutKeyAction} className="space-y-2" submit="Mostrar chave Pix" submitVariant="secondary" submitClassName=""><input type="hidden" name="withdrawalId" value={w.id} /></ActionForm>
              <div className="flex flex-wrap gap-3">
                <ActionForm action={resolveProcessingAction} className="flex flex-wrap items-end gap-2" submit="Confirmar que PAGUEI" submitClassName=""><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="outcome" value="paid" /><Input name="note" required minLength={5} placeholder="Ex.: pago no banco, comprovante conferido" className="w-72" /><Input name="e2e" placeholder="E2E ID do comprovante (opcional)" className="w-56" /></ActionForm>
                <ActionForm action={resolveProcessingAction} className="flex flex-wrap items-end gap-2" submit="NÃO paguei (devolver ao saldo)" submitVariant="danger" submitClassName="" confirm="Devolver este valor ao saldo da equipe? Faça isso só se o Pix NÃO foi enviado."><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="outcome" value="failed" /><Input name="note" required minLength={5} placeholder="Motivo" className="w-60" /></ActionForm>
              </div>
            </Card>
          ))}
        </section>
      )}
      <section className="space-y-4">
        <h2 className="font-bold">Presos em “enviando” há mais de 10 min ({stuck.length})</h2>
        <p className="text-sm text-muted">Resposta ambígua do provedor: o dinheiro pode ou não ter saído. Confira no painel do banco/provedor antes de decidir — nunca reenviamos nem devolvemos automaticamente.</p>
        {stuck.length === 0 ? <Empty title="Nenhum saque preso" /> : stuck.map((w) => (
          <Card key={w.id} className="space-y-3">
            <p className="font-bold">{formatMoney(w.netCents)} <span className="text-sm font-normal text-muted">· {t(w.teamId)?.name} · transferência {w.providerTransferId ?? "sem id no provedor"} · {w.failureReason}</span></p>
            <div className="flex flex-wrap gap-3">
              <ActionForm action={resolveProcessingAction} className="flex flex-wrap items-end gap-2" submit="Confirmar que foi PAGO" submitClassName=""><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="outcome" value="paid" /><Input name="note" required minLength={5} placeholder="Evidência" className="w-60" /><Input name="e2e" placeholder="E2E ID (opcional)" className="w-48" /></ActionForm>
              <ActionForm action={resolveProcessingAction} className="flex flex-wrap items-end gap-2" submit="Confirmar que NÃO saiu (devolver)" submitVariant="danger" submitClassName=""><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="outcome" value="failed" /><Input name="note" required minLength={5} placeholder="Evidência" className="w-60" /></ActionForm>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
