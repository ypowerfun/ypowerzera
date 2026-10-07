import type { Metadata } from "next";
import Link from "next/link";
import { GAMES } from "@/games";
import { Badge, Card, GameBadge, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Jogos e formatos" };

export default function GamesPage() {
  return (
    <>
      <PageTitle title="Jogos e formatos" subtitle="Cada jogo tem modos, regras e formatos de campeonato baseados nos circuitos oficiais." />
      <div className="grid gap-4 md:grid-cols-2">
        {GAMES.map((g) => (
          <Link key={g.id} href={`/jogos/${g.slug}`} className="focus-ring rounded-xl">
            <Card className="h-full transition hover:border-brand-soft/60">
              <div className="flex items-start gap-3">
                <GameBadge game={g} size="lg" />
                <div>
                  <h2 className="text-lg font-bold">{g.name}</h2>
                  <p className="text-sm text-muted">{g.tagline}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone="brand">{g.category}</Badge>
                    {g.modes.map((m) => <Badge key={m.id}>{m.label}</Badge>)}
                    <Badge tone="brand">{g.presets.length} formatos</Badge>
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
