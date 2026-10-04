import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getGameBySlug } from "@/games";
import { describeStage } from "@/engine";
import { db } from "@/lib/db";
import { TournamentCard } from "@/components/tournament-card";
import { RichText } from "@/components/rich-text";
import { finalizeRules } from "@/games";
import { Badge, ButtonLink, Card, GameBadge } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = getGameBySlug((await params).slug);
  return { title: g?.name ?? "Jogo" };
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const game = getGameBySlug((await params).slug);
  if (!game) notFound();
  const tournaments = await db.tournament.findMany({
    where: { gameId: game.id, visibility: "PUBLIC", status: { in: ["REGISTRATION", "CHECK_IN", "LIVE"] } },
    orderBy: { startsAt: "asc" },
    take: 6,
    include: { _count: { select: { participants: { where: { status: { in: ["REGISTERED", "CHECKED_IN", "PENDING_PAYMENT"] } } } } } },
  });
  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-center gap-4">
        <GameBadge abbr={game.abbr} accent={game.accent} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-black">{game.name}</h1>
          <p className="text-muted">{game.tagline}</p>
        </div>
        <ButtonLink href={`/organizar/novo?jogo=${game.id}`}>Criar campeonato de {game.abbr}</ButtonLink>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <h2 className="mb-2 font-bold">Sobre</h2>
          <p className="text-sm leading-relaxed text-muted">{game.description}</p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <Badge tone="brand">{game.category}</Badge>
            {game.platforms.map((p) => <Badge key={p}>{p}</Badge>)}
            {game.regions.map((r) => <Badge key={r} tone="neutral">{r}</Badge>)}
          </div>
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">Modos</h2>
          <ul className="space-y-2 text-sm">
            {game.modes.map((m) => (
              <li key={m.id}>
                <span className="font-semibold">{m.label}</span> <span className="text-muted">— {m.teamSize === 1 ? "individual" : `${m.teamSize} titulares${m.maxSubs ? ` + até ${m.maxSubs} reserva(s)` : ""}`}</span>
                {m.description && <p className="text-xs text-muted">{m.description}</p>}
              </li>
            ))}
          </ul>
          <h3 className="mb-1 mt-4 text-sm font-bold">Contas exigidas</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
            {game.identity.filter((f) => f.required).map((f) => <li key={f.key}>{f.label}</li>)}
          </ul>
        </Card>
      </section>

      <section>
        <h2 className="mb-1 text-xl font-extrabold">Formatos de campeonato</h2>
        <p className="mb-4 text-sm text-muted">Presets prontos (você pode ajustar etapas, melhor-de-N e pontuação ao criar).</p>
        <div className="grid gap-4 md:grid-cols-2">
          {game.presets.map((p) => (
            <Card key={p.id}>
              <h3 className="font-bold text-brand-soft">{p.name}</h3>
              <p className="mt-1 text-sm text-muted">{p.description}</p>
              <ol className="mt-3 space-y-1 text-xs">
                {p.stages.map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="font-bold text-accent">{i + 1}.</span><span><b>{s.name}:</b> <span className="text-muted">{describeStage(s.settings)}</span></span></li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-muted">{p.minParticipants === p.maxParticipants ? `${p.minParticipants} participantes` : `${p.minParticipants} a ${p.maxParticipants} participantes (ideal: ${p.suggestedParticipants})`}</p>
              <p className="mt-1 text-[11px] text-muted/80">Base: {p.basedOn}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-bold">Configurações de partida</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">{game.matchSettings.map((m, i) => <li key={i}>{m}</li>)}</ul>
          {game.mapPool && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-bold">Pool de mapas {game.vetoSupported && <Badge tone="accent">veto na plataforma</Badge>}</h3>
              <p className="mb-2 text-xs text-muted">{game.mapPool.label}</p>
              <div className="flex flex-wrap gap-1.5">{game.mapPool.maps.map((m) => <Badge key={m}>{m}</Badge>)}</div>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-2 font-bold">Regulamento padrão</h2>
          <RichText text={finalizeRules(game)} />
        </Card>
      </section>

      {game.notes && game.notes.length > 0 && (
        <Card>
          <h2 className="mb-2 font-bold">Fontes e pontos a conferir</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-xs text-muted">{game.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </Card>
      )}

      <section>
        <h2 className="mb-4 text-xl font-extrabold">Campeonatos de {game.name}</h2>
        {tournaments.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{tournaments.map((t) => <TournamentCard key={t.id} t={t} count={t._count.participants} />)}</div>
        ) : (
          <Card className="text-sm text-muted">Nenhum campeonato aberto para este jogo.</Card>
        )}
      </section>
    </div>
  );
}
