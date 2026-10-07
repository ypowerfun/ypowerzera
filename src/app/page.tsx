import Link from "next/link";
import { GAMES } from "@/games";
import { upcomingTournaments } from "@/server/queries";
import { isWalletOn } from "@/server/settings";
import { TournamentCard } from "@/components/tournament-card";
import { ButtonLink, Card, GameBadge, SectionTitle } from "@/components/ui";
import { GameWall } from "@/components/game-wall";

export const dynamic = "force-dynamic";

const BASE_FEATURES = [
  { title: "Todos os formatos", text: "Eliminação simples e dupla, grupos, pontos corridos, Suíço (3V/3D), GSL e leaderboards de battle royale com match point." },
  { title: "Presets por jogo", text: "Cada jogo já vem com os formatos reais: Worlds, Major de CS, Champions, VCT, ALGS, FNCS, TFT Checkmate, Capcom Cup..." },
  { title: "Inscrição e check-in", text: "Elencos validados, contas de jogo, campos personalizados, fila de espera e check-in com janela configurável." },
  { title: "Resultados confiáveis", text: "Relato de placar pelos dois capitães, disputas, W.O. automático, veto de mapas e histórico auditável." },
];
const WALLET_FEATURES = [
  { title: "Carteira por equipe", text: "Depósito via Pix e saque protegidos por identidade verificada, código por e-mail e liberação do administrador. 1 crédito = R$ 1." },
  { title: "Desafios equipe vs equipe", text: "Aposte créditos contra outra equipe. O valor fica em custódia até o resultado, com confirmação, disputa e arbitragem." },
];

const STEPS = [
  { title: "Crie sua conta e seu time", text: "Cadastre-se, vincule suas contas de jogo e monte o elenco. Quem cria o time vira o líder dele." },
  { title: "Entre em um campeonato", text: "Inscreva o time, faça o check-in e acompanhe as chaves ao vivo. Organizadores montam campeonatos em poucos minutos." },
  { title: "Dispute e conquiste", text: "Reporte os placares com o adversário, avance na chave e receba a premiação." },
];

const presetCount = GAMES.reduce((n, g) => n + g.presets.length, 0);

export default async function Home() {
  const [upcoming, walletOn] = await Promise.all([upcomingTournaments(6), isWalletOn()]);
  const features = walletOn ? [...BASE_FEATURES, ...WALLET_FEATURES] : BASE_FEATURES;
  const stats = [
    { value: String(GAMES.length), label: "jogos suportados" },
    { value: String(presetCount), label: "formatos prontos" },
    { value: "Troféus e R$", label: "em premiação" },
  ];
  return (
    <div className="space-y-16">
      {/* banner: texto à esquerda e, à direita, a parede inclinada com as logos dos jogos (cada uma leva à página do jogo) */}
      <section aria-labelledby="hero-title" className="relative isolate overflow-hidden rounded-xl border border-brand/60 bg-surface shadow-glow">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(900px_420px_at_85%_40%,rgb(225_29_42/0.22),transparent_65%),radial-gradient(700px_380px_at_0%_0%,rgb(255_255_255/0.05),transparent_60%)]" />
        <div className="grid items-stretch lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative z-10 px-6 pb-2 pt-8 sm:px-10 sm:pt-12 lg:py-14 lg:pl-12 lg:pr-0">
            <p className="mb-4 inline-flex items-center gap-2 border-l-2 border-brand bg-brand/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-brand-soft">
              <span aria-hidden className="h-1.5 w-1.5 rotate-45 bg-brand" />
              <span><span className="hidden sm:inline">Plataforma de </span>campeonatos de esports</span>
            </p>
            <h1 id="hero-title" className="display text-4xl leading-[1.04] sm:text-5xl lg:text-6xl">
              <span className="text-metal">Qual jogo</span>
              <br />
              <span className="text-red-metal">você joga?</span>
            </h1>
            <p className="mt-5 max-w-md text-base text-muted sm:text-lg">Escolha um jogo para encontrar campeonatos abertos, montar o seu time e acompanhar as chaves ao vivo{walletOn ? " — ou desafie outra equipe valendo créditos" : ""}.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="/jogos">Escolher um jogo <span aria-hidden>→</span></ButtonLink>
              <ButtonLink href="/torneios" variant="light">Ver torneios</ButtonLink>
              {walletOn && <ButtonLink href="/desafios" variant="secondary">Desafiar uma equipe</ButtonLink>}
            </div>
            <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-4">
              {stats.map((x) => (
                <div key={x.label} className="border-l-2 border-brand/70 pl-3">
                  <dt className="sr-only">{x.label}</dt>
                  <dd className="text-2xl font-black text-ink">{x.value}</dd>
                  <dd className="text-xs text-muted" aria-hidden>{x.label}</dd>
                </div>
              ))}
            </dl>
          </div>
          <GameWall games={GAMES} />
        </div>
      </section>

      <section aria-labelledby="proximos">
        <SectionTitle id="proximos" action={<Link href="/torneios" className="text-sm text-brand-soft hover:underline">Ver todos →</Link>}>Próximos campeonatos</SectionTitle>
        {upcoming.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((t) => <TournamentCard key={t.id} t={t} count={t._count.participants} orgName={t.org.name} />)}
          </div>
        ) : (
          <Card className="text-center text-sm text-muted">Nenhum campeonato aberto agora. Volte em breve ou <Link href="/torneios" className="text-brand-soft hover:underline">veja os campeonatos anteriores</Link>.</Card>
        )}
      </section>

      <section aria-labelledby="jogos">
        <SectionTitle id="jogos" action={<Link href="/jogos" className="text-sm text-brand-soft hover:underline"><span className="hidden sm:inline">Ver formatos de cada jogo</span><span className="sm:hidden">Ver formatos</span> →</Link>}>Jogos suportados</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {GAMES.map((g) => (
            <Link key={g.id} href={`/jogos/${g.slug}`} className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface/80 p-3 transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-glow focus-ring">
              <GameBadge game={g} size="lg" />
              <span className="min-w-0"><span className="block text-sm font-bold leading-tight">{g.name}</span><span className="block truncate text-xs text-muted">{g.category}</span></span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="como">
        <SectionTitle id="como">Como funciona</SectionTitle>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative border border-line bg-surface/80 p-5 pl-16">
              <span aria-hidden className="display absolute left-4 top-3 text-4xl text-red-metal">{i + 1}</span>
              <h3 className="font-black uppercase tracking-wide">{s.title}</h3>
              <p className="mt-2 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="recursos">
        <SectionTitle id="recursos">Tudo para organizar e jogar</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title} className="relative overflow-hidden">
              <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand/70 to-transparent" />
              <h3 className="font-black uppercase tracking-wide text-silver">{f.title}</h3>
              <p className="mt-2 text-sm text-muted">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="entre" className="corners relative rounded-lg border border-line bg-gradient-to-br from-[#1a0b0f] via-surface to-[#101218] p-8 sm:p-12">
        <div aria-hidden className="absolute inset-0 overflow-hidden rounded-lg">
          <div className="absolute -right-10 -top-16 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgb(225_29_42/0.35),transparent_70%)] blur-xl" />
        </div>
        <div className="relative max-w-xl">
          <h2 id="entre" className="display text-3xl text-metal sm:text-4xl">Entre na arena</h2>
          <p className="mt-3 text-muted">Monte sua equipe e dispute os campeonatos abertos — ou, se você é organizador, crie o seu e deixe as chaves por nossa conta.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/times/novo">Criar minha equipe</ButtonLink>
            <ButtonLink href="/torneios" variant="light">Ver torneios abertos</ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}
