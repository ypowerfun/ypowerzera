import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requestBalanceReviewAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Flash } from "@/components/flash";
import { WalletUnavailable } from "@/components/wallet-off";
import { Alert, Badge, ButtonLink, Card, Empty, Field, PageTitle, Stat, Textarea } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getKyc } from "@/server/kyc";
import { requireUser } from "@/server/session";
import { isWalletOn } from "@/server/settings";
import { leaderDeletedTeams, leaderTeams } from "@/server/team-auth";

export const metadata: Metadata = { title: "Carteira" };
export const dynamic = "force-dynamic";

export default async function WalletHome() {
  const user = await requireUser("/carteira");
  if (!(await isWalletOn())) return <WalletUnavailable />;
  const [kyc, teams, deletedTeams] = await Promise.all([getKyc(user.id), leaderTeams(user.id), leaderDeletedTeams(user.id)]);
  return (
    <div className="space-y-6">
      <PageTitle title="Carteira da equipe" subtitle="Créditos (1 crédito = R$ 1,00) pertencem à equipe. Só o líder deposita, saca e aposta em desafios." />
      <Suspense fallback={null}><Flash /></Suspense>
      {(!kyc || kyc.status === "REJECTED") && <Alert tone="warn" className="flex flex-wrap items-center justify-between gap-3"><span>Antes de movimentar créditos você precisa verificar sua identidade (CPF e maioridade).</span><ButtonLink href="/carteira/verificacao" variant="secondary">Verificar identidade</ButtonLink></Alert>}
      {kyc?.status === "PENDING" && <Alert>Sua identidade está <b>em análise</b>. Você já pode depositar; saques e desafios liberam após a aprovação.</Alert>}
      {kyc?.status === "VERIFIED" && <Alert tone="ok">Identidade verificada ({kyc.fullName}, CPF final {kyc.cpfLast4}).</Alert>}

      {deletedTeams.length > 0 && (
        <section aria-labelledby="bloqueados" className="space-y-3">
          <h2 id="bloqueados" className="font-bold">Equipes excluídas com saldo</h2>
          {deletedTeams.map(({ team }) => {
            const req = team.releaseRequests[0];
            const balance = team.wallet?.balanceCents ?? 0;
            const released = !!team.balanceReleasedAt;
            return (
              <Card key={team.id} className="space-y-3 border-warn/40">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold">[{team.tag}] {team.name}</h3>
                    <p className="text-xs text-muted">Excluída em {team.deletedAt ? formatDate(team.deletedAt) : "—"}</p>
                  </div>
                  <div className="flex items-center gap-2"><span className="text-lg font-black tabular-nums">{formatMoney(balance)}</span><Badge tone={released ? "ok" : "warn"}>{released ? "liberado para saque" : req?.status === "PENDING" ? "em análise" : "bloqueado"}</Badge></div>
                </div>
                {released ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted">O administrador liberou este saldo. O saque segue as regras de segurança de sempre (identidade, senha, código por e-mail) e vai para o seu CPF.</p>
                    {balance > 0 && <ButtonLink href={`/carteira/${team.id}`}>Sacar o saldo</ButtonLink>}
                  </div>
                ) : req?.status === "PENDING" ? (
                  <Alert>Pedido de revisão enviado em {formatDateTime(req.createdAt)}. Um administrador vai analisar e você será avisado por notificação.</Alert>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted">Com a equipe excluída, o saldo fica <b className="text-ink">bloqueado</b>. Peça a revisão: um administrador confere o histórico e, se aprovar, libera o saldo para você sacar.</p>
                    {req?.status === "REJECTED" && <Alert tone="warn">O pedido anterior foi recusado{req.reviewNote ? <>: <i>{req.reviewNote}</i></> : "."} Você pode enviar um novo pedido com mais detalhes.</Alert>}
                    {balance <= 0 ? <p className="text-sm text-muted">Não há saldo disponível para liberar.</p> : kyc?.status !== "VERIFIED" ? (
                      <Alert tone="warn" className="flex flex-wrap items-center justify-between gap-3"><span>Para receber o saque é preciso ter a identidade <b>verificada</b>.</span><ButtonLink href="/carteira/verificacao" variant="secondary">Verificar identidade</ButtonLink></Alert>
                    ) : (
                      <ActionForm action={requestBalanceReviewAction} className="space-y-3" submit="Pedir revisão do saldo" submitClassName="">
                        <input type="hidden" name="teamId" value={team.id} />
                        <Field label="Explique o pedido (10 a 500 caracteres)" htmlFor={`msg-${team.id}`}><Textarea id={`msg-${team.id}`} name="message" required minLength={10} maxLength={500} rows={3} placeholder="Ex.: o time foi desfeito e quero sacar o saldo para a minha conta." /></Field>
                      </ActionForm>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      )}

      {teams.length === 0 ? (
        <Empty title="Você não lidera nenhuma equipe">Crie uma equipe: quem cria é o líder e pode movimentar o saldo dela. <Link href="/times/novo" className="text-brand-soft hover:underline">Criar equipe</Link></Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map(({ team }) => (
            <Link key={team.id} href={`/carteira/${team.id}`} className="focus-ring rounded-xl">
              <Card className="@container h-full transition hover:border-brand/50 hover:shadow-glow">
                <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">[{team.tag}] {team.name}</h2>{team.wallet?.frozenAt && <Badge tone="danger">congelada</Badge>}</div>
                <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
                  <Stat label="Disponível" value={formatMoney(team.wallet?.balanceCents ?? 0)} tone="ok" />
                  <Stat label="Em custódia" value={formatMoney(team.wallet?.lockedCents ?? 0)} />
                </div>
                <p className="mt-3 text-xs text-brand-soft">Abrir carteira →</p>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Card>
        <h2 className="mb-3 font-bold">Como funciona (e como protegemos o seu saldo)</h2>
        <ul className="grid gap-x-8 gap-y-2 text-sm text-muted md:grid-cols-2">
          <li>🔑 <b className="text-ink">Só o líder movimenta:</b> depósito, saque e desafios exigem ser o capitão da equipe.</li>
          <li>🪪 <b className="text-ink">Identidade verificada:</b> CPF único por conta, maiores de 18 anos. Guardamos o CPF cifrado.</li>
          <li>💸 <b className="text-ink">Depósito por Pix:</b> só vira crédito depois da confirmação do banco, conferida direto no provedor.</li>
          <li>🏦 <b className="text-ink">Saque só para o seu CPF:</b> o Pix vai para a chave do titular verificado, nunca para terceiros.</li>
          <li>✉️ <b className="text-ink">Senha + código por e-mail</b> em todo saque, com janela para cancelar e revisão humana de saques de risco.</li>
          <li>🔄 <b className="text-ink">Giro obrigatório:</b> o depósito precisa ser jogado em desafios antes de sair, e valores recentes ficam retidos por segurança.</li>
          <li>🧾 <b className="text-ink">Razão imutável:</b> todo movimento é registrado e conciliado; o saldo nunca fica negativo.</li>
          <li>🛡️ <b className="text-ink">Custódia nos desafios:</b> o valor apostado fica bloqueado até o resultado, com confirmação e arbitragem.</li>
        </ul>
      </Card>
    </div>
  );
}
