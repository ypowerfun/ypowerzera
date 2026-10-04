import Link from "next/link";
import { GAMES } from "@/games";
import { upcomingTournaments } from "@/server/queries";
import { TournamentCard } from "@/components/tournament-card";
import { ButtonLink, Card, GameBadge, SectionTitle } from "@/components/ui";
import { CrownIcon } from "@/components/icons";
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

const presetCount = GAMES.reduce((n, g) => n + g.presets.length, 0);
const mainGames = GAMES.filter((g) => g.id !== "csgo"); // CS:GO (legado) é uma versão de Counter-Strike, não outro jogo
const STATS = [
  { value: String(mainGames.length), label: "jogos suportados" },
  { value: String(presetCount), label: "formatos prontos" },
  { value: "R$ 1", label: "= 1 crédito" },
];

export default async function Home() {
  const upcoming = await upcomingTournaments(6);
  return (
    <div className="space-y-16">
      <section className="relative grid items-center gap-8 pt-2 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10">
        <div className="order-2 lg:order-1">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gold">
            <CrownIcon className="h-3.5 w-3.5 shrink-0" /> <span><span className="hidden sm:inline">Plataforma de </span>campeonatos de esports</span>
          </p>
          <h1 className="display text-4xl leading-[1.02] sm:text-5xl lg:text-6xl">
            <span className="text-metal">Crie. Dispute.</span>
            <br />
            <span className="text-gold-metal">Vença.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">Chaves automáticas, inscrições, check-in e resultados para LoL, Valorant, CS2, Fortnite, Apex, Battlefield 6, Warzone, TFT, Street Fighter e EA FC — e desafios entre equipes valendo créditos.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/torneios">Ver torneios</ButtonLink>
            <ButtonLink href="/organizar/novo" variant="gold">Criar um campeonato</ButtonLink>
            <ButtonLink href="/desafios" variant="secondary">Desafiar uma equipe</ButtonLink>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-4">
            {STATS.map((s) => (
              <div key={s.label} className="border-l-2 border-gold/60 pl-3">
                <dt className="sr-only">{s.label}</dt>
                <dd className="text-2xl font-black text-ink">{s.value}</dd>
                <dd className="text-xs text-muted" aria-hidden>{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* arte oficial com o brilho da arena (azul à esquerda, ouro à direita, violeta ao fundo) */}
        <div className="relative order-1 mx-auto w-48 sm:w-80 lg:order-2 lg:w-[26rem]">
          <div aria-hidden className="absolute -inset-8 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(47_134_255/0.45),rgb(124_77_255/0.22)_55%,transparent_75%)] blur-2xl" />
          <div aria-hidden className="absolute -bottom-6 -right-6 -z-10 h-2/3 w-2/3 rounded-full bg-[radial-gradient(closest-side,rgb(245_163_11/0.35),transparent_70%)] blur-2xl" />
          <Logo variant="art" className="float-slow w-full shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_30px_80px_-20px_rgb(22_100_230/0.7)]" />
        </div>
      </section>

      <section aria-labelledby="jogos">
        <SectionTitle id="jogos" action={<Link href="/jogos" className="text-sm text-brand-soft hover:underline"><span className="hidden sm:inline">Ver formatos de cada jogo</span><span className="sm:hidden">Ver formatos</span> →</Link>}>Jogos suportados</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {GAMES.map((g) => (
            <Link key={g.id} href={`/jogos/${g.slug}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface/80 p-3 transition hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-gold focus-ring">
              <GameBadge abbr={g.abbr} accent={g.accent} />
              <span className="min-w-0"><span className="block text-sm font-bold leading-tight">{g.name}</span><span className="block truncate text-xs text-muted">{g.category}</span></span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="proximos">
        <SectionTitle id="proximos" action={<Link href="/torneios" className="text-sm text-brand-soft hover:underline">Ver todos →</Link>}>Próximos campeonatos</SectionTitle>
        {upcoming.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((t) => <TournamentCard key={t.id} t={t} count={t._count.participants} orgName={t.org.name} />)}
          </div>
        ) : (
          <Card className="text-center text-sm text-muted">Nenhum campeonato aberto agora. <Link href="/organizar/novo" className="text-brand-soft hover:underline">Crie o primeiro!</Link></Card>
        )}
      </section>

      <section aria-labelledby="recursos">
        <SectionTitle id="recursos">Tudo para organizar e jogar</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Card key={f.title} className="relative overflow-hidden">
              <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-soft/60 to-transparent" />
              <span aria-hidden className="display text-3xl text-gold/30">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-1 font-bold text-brand-soft">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="entre" className="corners relative rounded-2xl border border-brand/30 bg-gradient-to-br from-[#0a1d52] via-[#120d45] to-[#2b1a06] p-8 sm:p-12">
        <div aria-hidden className="absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -right-10 -top-16 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgb(124_77_255/0.35),transparent_70%)] blur-xl" />
        </div>
        <div className="relative max-w-xl">
          <h2 id="entre" className="display text-3xl text-metal sm:text-4xl">Entre na arena</h2>
          <p className="mt-3 text-muted">Monte sua equipe, deposite créditos e desafie quem quiser — ou crie o seu campeonato e deixe as chaves por nossa conta.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/times/novo" variant="gold">Criar minha equipe</ButtonLink>
            <ButtonLink href="/torneios" variant="secondary">Ver torneios abertos</ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
