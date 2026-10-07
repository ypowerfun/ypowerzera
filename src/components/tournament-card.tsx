import Link from "next/link";
import { getGame } from "@/games";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { STATUS_LABELS } from "@/lib/phases";
import { CrownIcon } from "./icons";
import { Badge, GameBadge } from "./ui";
import type { Tournament } from "@prisma/client";

const tone = { DRAFT: "neutral", REGISTRATION: "ok", CHECK_IN: "warn", LIVE: "accent", COMPLETED: "neutral", CANCELED: "danger" } as const;

export function TournamentCard({ t, count, orgName }: { t: Tournament; count: number; orgName?: string }) {
  const game = getGame(t.gameId);
  return (
    <Link href={`/torneios/${t.slug}`} className="group block min-w-0 rounded-xl border border-line bg-surface/80 p-5 transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-glow focus-ring">
      <div className="flex items-center gap-3">
        {game && <GameBadge abbr={game.abbr} accent={game.accent} />}
        <p className="min-w-0 truncate text-xs text-muted">{game?.name}</p>
        <Badge tone={tone[t.status]} className="ml-auto shrink-0">{STATUS_LABELS[t.status]}</Badge>
      </div>
      <h3 className="mt-3 line-clamp-2 font-bold group-hover:text-brand-soft">{t.name}</h3>
      {orgName && <p className="mt-0.5 truncate text-xs text-muted">por {orgName}</p>}
      <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div><dt className="text-muted">Início</dt><dd className="font-semibold">{formatDateTime(t.startsAt)}</dd></div>
        <div><dt className="text-muted">Inscrição</dt><dd className="font-semibold">{t.entryFeeCents ? formatMoney(t.entryFeeCents, t.currency) : "Grátis"}</dd></div>
        <div><dt className="text-muted">Vagas</dt><dd className="font-semibold">{count}/{t.maxParticipants}</dd></div>
      </dl>
      {t.prizePoolCents > 0 && <p className="mt-3 flex items-center gap-1.5 text-xs"><CrownIcon className="h-3.5 w-3.5 text-silver" /><span className="text-muted">Premiação</span> <span className="font-black text-silver">{formatMoney(t.prizePoolCents, t.currency)}</span></p>}
    </Link>
  );
}
