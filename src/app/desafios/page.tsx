import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, Empty, GameBadge, PageTitle, Select, buttonClass } from "@/components/ui";
import { GAMES, getGame } from "@/games";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { challengeFee, listOpenChallenges } from "@/server/challenges";
import { getCurrentUser } from "@/server/session";
import { WalletUnavailable } from "@/components/wallet-off";
import { isWalletOn } from "@/server/settings";

export const metadata: Metadata = { title: "Desafios" };
export const dynamic = "force-dynamic";

const statusLabel = { OPEN: "Aberto", ACCEPTED: "Em andamento", REPORTED: "Aguardando confirmação", DISPUTED: "Em disputa", SETTLED: "Encerrado", CANCELED: "Cancelado", EXPIRED: "Expirado", VOID: "Anulado" } as const;
const statusTone = { OPEN: "ok", ACCEPTED: "brand", REPORTED: "warn", DISPUTED: "danger", SETTLED: "neutral", CANCELED: "neutral", EXPIRED: "neutral", VOID: "neutral" } as const;

export default async function ChallengesPage({ searchParams }: { searchParams: Promise<{ jogo?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!(await isWalletOn())) return <WalletUnavailable />;
  const open = await listOpenChallenges({ gameId: sp.jogo || undefined });
  const myTeamIds = user ? (await db.teamMember.findMany({ where: { userId: user.id, role: "CAPTAIN" }, select: { teamId: true } })).map((m) => m.teamId) : [];
  const mine = myTeamIds.length
    ? await db.challenge.findMany({ where: { OR: [{ creatorTeamId: { in: myTeamIds } }, { opponentTeamId: { in: myTeamIds } }], status: { notIn: ["CANCELED", "EXPIRED"] } }, orderBy: { createdAt: "desc" }, take: 12, include: { creatorTeam: true, opponentTeam: true } })
    : [];
  return (
    <div className="space-y-8">
      <PageTitle title="Desafios equipe vs equipe" subtitle="Aposte créditos (1 crédito = R$ 1,00) contra outra equipe. O valor fica em custódia até o resultado; quem vence leva o pote menos a taxa da plataforma." actions={<ButtonLink href="/desafios/novo">Criar desafio</ButtonLink>} />
      <Alert tone="warn">Valendo dinheiro: apenas maiores de 18 anos com identidade verificada, e só o líder da equipe aposta. Jogue com responsabilidade.</Alert>

      {mine.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-extrabold">Meus desafios</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {mine.map((c) => (
              <Link key={c.id} href={`/desafios/${c.id}`} className="focus-ring rounded-xl">
                <Card className="py-4 transition hover:border-brand-soft/60">
                  <div className="flex items-center justify-between gap-2"><span className="font-bold">{c.creatorTeam.name} <span className="text-muted">×</span> {c.opponentTeam?.name ?? "aguardando adversário"}</span><Badge tone={statusTone[c.status]}>{statusLabel[c.status]}</Badge></div>
                  <p className="mt-1 text-xs text-muted">{getGame(c.gameId)?.name} · melhor de {c.bestOf} · aposta {formatMoney(c.stakeCents)}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">Desafios abertos</h2>
          <form className="flex gap-2" role="search">
            <Select name="jogo" defaultValue={sp.jogo ?? ""} aria-label="Filtrar por jogo" className="w-56"><option value="">Todos os jogos</option>{GAMES.filter((g) => g.modes.some((m) => m.teamSize <= 5)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>
            <button className={buttonClass("secondary")}>Filtrar</button>
          </form>
        </div>
        {open.length === 0 ? (
          <Empty title="Nenhum desafio aberto agora">Seja o primeiro a <Link href="/desafios/novo" className="text-brand-soft hover:underline">lançar um desafio</Link>.</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {open.map((c) => {
              const g = getGame(c.gameId);
              const fee = challengeFee(c.stakeCents, c.feeBps);
              return (
                <Link key={c.id} href={`/desafios/${c.id}`} className="focus-ring rounded-xl">
                  <Card className="h-full transition hover:border-brand-soft/60 hover:shadow-glow">
                    <div className="flex items-center gap-3">{g && <GameBadge game={g} />}<div className="min-w-0"><p className="truncate font-bold">{c.creatorTeam.name}</p><p className="truncate text-xs text-muted">{g?.name} · {g?.modes.find((m) => m.id === c.modeId)?.label} · melhor de {c.bestOf}</p></div></div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div><p className="text-xs text-muted">Aposta de cada equipe</p><p className="text-xl font-black text-silver">{formatMoney(c.stakeCents)}</p></div>
                      <div><p className="text-xs text-muted">Vencedor recebe</p><p className="text-xl font-black text-ok">{formatMoney(c.stakeCents * 2 - fee)}</p></div>
                    </div>
                    <p className="mt-3 text-xs text-muted">Expira em {formatDateTime(c.expiresAt)}</p>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
