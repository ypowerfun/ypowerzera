import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, Empty, PageTitle, Stat } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getKyc } from "@/server/kyc";
import { requireUser } from "@/server/session";
import { leaderTeams } from "@/server/team-auth";

export const metadata: Metadata = { title: "Carteira" };
export const dynamic = "force-dynamic";

export default async function WalletHome() {
  const user = await requireUser("/carteira");
  const [kyc, teams] = await Promise.all([getKyc(user.id), leaderTeams(user.id)]);
  return (
    <div className="space-y-6">
      <PageTitle title="Carteira da equipe" subtitle="Créditos (1 crédito = R$ 1,00) pertencem à equipe. Só o líder deposita, saca e aposta em desafios." />
      {(!kyc || kyc.status === "REJECTED") && <Alert tone="warn" className="flex flex-wrap items-center justify-between gap-3"><span>Antes de movimentar créditos você precisa verificar sua identidade (CPF e maioridade).</span><ButtonLink href="/carteira/verificacao" variant="secondary">Verificar identidade</ButtonLink></Alert>}
      {kyc?.status === "PENDING" && <Alert>Sua identidade está <b>em análise</b>. Você já pode depositar; saques e desafios liberam após a aprovação.</Alert>}
      {kyc?.status === "VERIFIED" && <Alert tone="ok">Identidade verificada ({kyc.fullName}, CPF final {kyc.cpfLast4}).</Alert>}

      {teams.length === 0 ? (
        <Empty title="Você não lidera nenhuma equipe">Crie uma equipe: quem cria é o líder e pode movimentar o saldo dela. <Link href="/times/novo" className="text-brand-soft hover:underline">Criar equipe</Link></Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map(({ team }) => (
            <Link key={team.id} href={`/carteira/${team.id}`} className="focus-ring rounded-xl">
              <Card className="h-full transition hover:border-brand-soft/60 hover:shadow-glow">
                <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">[{team.tag}] {team.name}</h2>{team.wallet?.frozenAt && <Badge tone="danger">congelada</Badge>}</div>
                <div className="grid grid-cols-2 gap-3">
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
