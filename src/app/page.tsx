import Link from "next/link";
import { GAMES } from "@/games";
import { upcomingTournaments } from "@/server/queries";
import { TournamentCard } from "@/components/tournament-card";
import { ButtonLink, Card, GameBadge } from "@/components/ui";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

const FEATURES = [
  { title: "Todos os formatos", text: "Eliminação simples e dupla, grupos, pontos corridos, Suíço (3V/3D), GSL e leaderboards de battle royale com match point." },
  { title: "Presets por jogo", text: "Cada jogo já vem com os formatos reais: Worlds, Major de CS, Champions, VCT, ALGS, FNCS, TFT Checkmate, Capcom Cup..." },
  { title: "Inscrição e check-in", text: "Elencos validados, contas de jogo, campos personalizados, fila de espera e check-in com janela configurável." },
  { title: "Carteira por equipe", text: "Depósito via Pix e saque protegidos por KYC, código por e-mail, revisão e autorização de transferência. 1 crédito = R$ 1." },
  { title: "Desafios equipe vs equipe", text: "Aposte créditos contra outra equipe. O valor fica em custódia até o resultado, com confirmação, disputa e arbitragem." },
  { title: "Resultados confiáveis", text: "Relato de placar pelos dois capitães, disputas, W.O. automático, veto de mapas e histórico auditável." },
];

export default async function Home() {
  const upcoming = await upcomingTournaments(6);
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Plataforma de campeonatos de esports
          </p>
          <h1 className="text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Crie, dispute e <span className="bg-gradient-to-r from-brand-soft to-accent bg-clip-text text-transparent">vença</span> campeonatos.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">Chaves automáticas, inscrições, check-in e resultados para LoL, Valorant, CS2, Fortnite, Apex, Battlefield 6, Warzone, TFT, Street Fighter e EA FC — e desafios entre equipes valendo créditos.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/torneios">Ver torneios</ButtonLink>
            <ButtonLink href="/organizar/novo" variant="secondary">Criar um campeonato</ButtonLink>
            <ButtonLink href="/desafios" variant="accent">Desafiar uma equipe</ButtonLink>
          </div>
        </div>
        <div className="relative hidden lg:block">
          <div className="absolute inset-0 -z-10 rounded-full bg-brand/20 blur-3xl" />
          <Logo variant="mark" className="mx-auto h-72 w-72 drop-shadow-[0_0_40px_rgba(59,130,246,0.55)]" />
        </div>
      </section>

      <section aria-labelledby="jogos">
        <div className="mb-4 flex items-end justify-between">
          <h2 id="jogos" className="text-xl font-extrabold">Jogos suportados</h2>
          <Link href="/jogos" className="text-sm text-brand-soft hover:underline">Ver formatos de cada jogo →</Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {GAMES.map((g) => (
            <Link key={g.id} href={`/jogos/${g.slug}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface/80 p-3 transition hover:border-brand-soft/60 focus-ring">
              <GameBadge abbr={g.abbr} accent={g.accent} />
              <span className="min-w-0"><span className="block truncate text-sm font-bold">{g.name}</span><span className="block truncate text-xs text-muted">{g.category}</span></span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="proximos">
        <div className="mb-4 flex items-end justify-between">
          <h2 id="proximos" className="text-xl font-extrabold">Próximos campeonatos</h2>
          <Link href="/torneios" className="text-sm text-brand-soft hover:underline">Ver todos →</Link>
        </div>
        {upcoming.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((t) => <TournamentCard key={t.id} t={t} count={t._count.participants} orgName={t.org.name} />)}
          </div>
        ) : (
          <Card className="text-center text-sm text-muted">Nenhum campeonato aberto agora. <Link href="/organizar/novo" className="text-brand-soft hover:underline">Crie o primeiro!</Link></Card>
        )}
      </section>

      <section aria-labelledby="recursos">
        <h2 id="recursos" className="mb-4 text-xl font-extrabold">Tudo para organizar e jogar</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title}>
              <h3 className="font-bold text-brand-soft">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
