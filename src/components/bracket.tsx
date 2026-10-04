import Link from "next/link";
import type { LeaderboardRow, SlotSource, StageSettings, StandingRow } from "@/engine";
import { roleForRound } from "@/engine";
import { GSL_LABELS } from "@/engine";
import type { MatchView, PNames, StageView } from "@/server/queries";
import { Badge, Table, Td, Th, cx } from "./ui";

function slotText(src: SlotSource): string {
  switch (src.kind) {
    case "winner":
      return `Vencedor ${src.match}`;
    case "loser":
      return `Perdedor ${src.match}`;
    case "slotA":
    case "slotB":
      return "Finalistas";
    case "bye":
      return "BYE";
    default:
      return "A definir";
  }
}

function side(m: MatchView, which: "a" | "b") {
  const p = which === "a" ? m.a : m.b;
  const src = which === "a" ? m.slotA : m.slotB;
  const score = which === "a" ? m.scoreA : m.scoreB;
  const won = m.status === "COMPLETED" && m.winnerSide === which;
  const lost = m.status === "COMPLETED" && m.winnerSide && m.winnerSide !== "draw" && m.winnerSide !== which;
  const isBye = !p && (src.kind === "bye" || m.status === "BYE");
  return (
    <div className={cx("flex items-center justify-between gap-2 px-3 py-1.5 text-sm", won && "bg-brand/15 font-semibold", lost && "opacity-60")}>
      <span className="flex min-w-0 items-center gap-2">
        {p?.seed != null && <span className="w-5 shrink-0 text-right text-[10px] text-muted">{p.seed}</span>}
        <span className={cx("truncate", !p && "text-muted italic")}>{p ? p.name : isBye ? "BYE" : slotText(src)}</span>
        {p?.tag && <span className="shrink-0 text-[10px] text-muted">[{p.tag}]</span>}
      </span>
      <span className={cx("shrink-0 tabular-nums", won ? "text-brand-soft" : "text-muted")}>{score ?? ""}</span>
    </div>
  );
}

export function MatchCard({ m, label }: { m: MatchView; label?: string }) {
  const playable = m.a && m.b;
  const tone: Record<string, string> = { READY: "border-brand/60", REPORTED: "border-warn/60", DISPUTED: "border-danger/60", COMPLETED: "border-line", BYE: "border-line-soft", PENDING: "border-line-soft", SKIPPED: "border-line-soft" };
  const body = (
    <div className={cx("overflow-hidden rounded-lg border bg-surface", tone[m.status] ?? "border-line", m.status === "BYE" && "opacity-50")}>
      <div className="flex items-center justify-between border-b border-line-soft bg-elevated/60 px-3 py-1 text-[10px] uppercase tracking-wider text-muted">
        <span>{label ?? m.key}</span>
        <span className="flex items-center gap-1.5">
          {m.forfeit && <span className="text-warn">W.O.</span>}
          <span>Bo{m.bestOf}</span>
          {m.status === "READY" && <span className="text-brand-soft">● pronta</span>}
          {m.status === "REPORTED" && <span className="text-warn">aguardando confirmação</span>}
          {m.status === "DISPUTED" && <span className="text-danger">disputa</span>}
        </span>
      </div>
      {side(m, "a")}
      <div className="h-px bg-line-soft" />
      {side(m, "b")}
    </div>
  );
  return playable ? (
    <Link href={`/partidas/${m.id}`} className="block rounded-lg transition hover:ring-2 hover:ring-brand-soft/50 focus-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

function roundTitle(bracket: string, round: number, total: number): string {
  if (bracket === "GF") return round === 1 ? "Grande final" : "Reset da grande final";
  if (bracket === "THIRD") return "Disputa de 3º lugar";
  const role = roleForRound(round, total);
  if (bracket === "W") return role === "final" ? "Final" : role === "semifinal" ? "Semifinal" : role === "quarterfinal" ? "Quartas" : `Rodada ${round}`;
  if (bracket === "L") return role === "final" ? "Final dos perdedores" : role === "semifinal" ? "Semifinal dos perdedores" : `Perdedores · R${round}`;
  return `Rodada ${round}`;
}

function Columns({ matches, bracket }: { matches: MatchView[]; bracket: string }) {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const total = rounds.length ? Math.max(...rounds) : 0;
  return (
    <div className="flex min-w-max items-stretch gap-6 pb-2">
      {rounds.map((r) => (
        <div key={r} className="bracket-col">
          <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wider text-muted">{roundTitle(bracket, r, total)}</p>
          {matches
            .filter((m) => m.round === r)
            .sort((a, b) => a.position - b.position)
            .map((m) => (
              <MatchCard key={m.id} m={m} />
            ))}
        </div>
      ))}
    </div>
  );
}

/** Chave eliminatória (simples ou dupla). */
export function EliminationBracket({ matches }: { matches: MatchView[] }) {
  const w = matches.filter((m) => m.bracket === "W");
  const l = matches.filter((m) => m.bracket === "L");
  const gf = matches.filter((m) => m.bracket === "GF" && m.status !== "SKIPPED");
  const third = matches.filter((m) => m.bracket === "THIRD");
  return (
    <div className="space-y-8">
      <section>
        {l.length > 0 && <h4 className="mb-3 text-sm font-bold text-brand-soft">Chave dos vencedores</h4>}
        <div className="overflow-x-auto"><Columns matches={w} bracket="W" /></div>
      </section>
      {l.length > 0 && (
        <section>
          <h4 className="mb-3 text-sm font-bold text-accent">Chave dos perdedores</h4>
          <div className="overflow-x-auto"><Columns matches={l} bracket="L" /></div>
        </section>
      )}
      {(gf.length > 0 || third.length > 0) && (
        <section className="flex flex-wrap gap-6">
          {gf.map((m) => (
            <div key={m.id} className="w-64">
              <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wider text-muted">{roundTitle("GF", m.round, 2)}</p>
              <MatchCard m={m} />
            </div>
          ))}
          {third.map((m) => (
            <div key={m.id} className="w-64">
              <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wider text-muted">Disputa de 3º lugar</p>
              <MatchCard m={m} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** Partidas agrupadas por rodada (grupos, pontos corridos e Swiss). */
export function RoundList({ matches, group }: { matches: MatchView[]; group?: number }) {
  const list = group ? matches.filter((m) => m.group === group) : matches;
  const rounds = [...new Set(list.map((m) => m.round))].sort((a, b) => a - b);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {rounds.map((r) => (
        <div key={r}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Rodada {r}</p>
          <div className="space-y-2">
            {list
              .filter((m) => m.round === r)
              .sort((a, b) => a.position - b.position)
              .map((m) => (
                <MatchCard key={m.id} m={m} label={GSL_LABELS[m.key.split("-").pop() ?? ""] ?? m.key} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function StandingsTable({ rows, showGroup, highlight = 0, swiss }: { rows: Array<StandingRow & { name: string; tag: string | null }>; showGroup?: boolean; highlight?: number; swiss?: Record<string, { wins: number; losses: number; state: string }> | null }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-10">#</Th>
          <Th>Participante</Th>
          {showGroup && <Th>Grupo</Th>}
          <Th className="text-center">J</Th>
          <Th className="text-center">V</Th>
          <Th className="text-center">E</Th>
          <Th className="text-center">D</Th>
          <Th className="text-center">Pts</Th>
          <Th className="text-center">Saldo</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.participantId} className={cx(i < highlight && "bg-brand/5")}>
            <Td className="font-bold text-muted">{r.rank}{r.tied ? "º*" : "º"}</Td>
            <Td>
              <span className="font-semibold">{r.name}</span> {r.tag && <span className="text-xs text-muted">[{r.tag}]</span>}
              {swiss?.[r.participantId] && <Badge tone={swiss[r.participantId].state === "advanced" ? "ok" : swiss[r.participantId].state === "eliminated" ? "danger" : "neutral"} className="ml-2">{swiss[r.participantId].wins}-{swiss[r.participantId].losses}</Badge>}
            </Td>
            {showGroup && <Td>{r.group ? String.fromCharCode(64 + r.group) : "—"}</Td>}
            <Td className="text-center tabular-nums">{r.played}</Td>
            <Td className="text-center tabular-nums">{r.wins}</Td>
            <Td className="text-center tabular-nums">{r.draws}</Td>
            <Td className="text-center tabular-nums">{r.losses}</Td>
            <Td className="text-center font-bold tabular-nums">{r.points}</Td>
            <Td className="text-center tabular-nums text-muted">{r.diff > 0 ? `+${r.diff}` : r.diff}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function LeaderboardTable({ rows, games, champion, advance }: { rows: Array<LeaderboardRow & { name: string; tag: string | null }>; games: number; champion?: string | null; advance?: number }) {
  const played = rows.reduce((m, r) => Math.max(m, ...r.perGame.map((g) => g.round), 0), 0);
  const cols = Array.from({ length: Math.max(played, 1) }, (_, i) => i + 1);
  void games;
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-10">#</Th>
          <Th>Time/Jogador</Th>
          <Th className="text-center">Pts</Th>
          <Th className="text-center">Vit.</Th>
          <Th className="text-center">Abates</Th>
          {cols.map((c) => (
            <Th key={c} className="text-center">P{c}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.participantId} className={cx((advance ?? 0) > i && "bg-brand/5")}>
            <Td className="font-bold text-muted">{r.rank}º</Td>
            <Td>
              <span className="font-semibold">{r.name}</span> {r.tag && <span className="text-xs text-muted">[{r.tag}]</span>}
              {champion === r.participantId && <Badge tone="ok" className="ml-2">Campeão</Badge>}
              {!champion && r.matchPointEligible && <Badge tone="warn" className="ml-2">Match point</Badge>}
            </Td>
            <Td className="text-center font-extrabold tabular-nums">{r.points}</Td>
            <Td className="text-center tabular-nums">{r.wins}</Td>
            <Td className="text-center tabular-nums">{r.kills}</Td>
            {cols.map((c) => {
              const g = r.perGame.find((x) => x.round === c);
              return (
                <Td key={c} className="text-center text-xs tabular-nums text-muted">
                  {g ? (
                    <span title={`${g.placement}º lugar, ${g.kills} abates`}>
                      <span className={g.placement === 1 ? "font-bold text-ok" : ""}>{g.placement}º</span>/{g.kills}
                    </span>
                  ) : (
                    "–"
                  )}
                </Td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function StageSummary({ stage }: { stage: StageView }) {
  const s: StageSettings = stage.settings;
  return <span className="text-xs text-muted">{s.type.replaceAll("_", " ").toLowerCase()}</span>;
}

export type { PNames };
