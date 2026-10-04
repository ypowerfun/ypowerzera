import type { Metadata } from "next";
import { resolveChallengeAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, Empty, Input, PageTitle } from "@/components/ui";
import { getGame } from "@/games";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { LineupMember } from "@/server/challenges";

export const metadata: Metadata = { title: "Admin · Desafios em disputa", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminChallenges() {
  const rows = await db.challenge.findMany({ where: { status: "DISPUTED" }, orderBy: { updatedAt: "asc" }, include: { creatorTeam: true, opponentTeam: true } });
  return (
    <div className="space-y-4">
      <PageTitle title="Desafios em disputa" subtitle="Decida com base nas provas. Você não pode decidir um desafio de equipe da qual faz parte." />
      {rows.length === 0 ? <Empty title="Nenhuma disputa aberta" /> : rows.map((c) => (
        <Card key={c.id} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{c.creatorTeam.name} × {c.opponentTeam?.name}</p><span className="text-sm text-muted">{getGame(c.gameId)?.name} · Bo{c.bestOf} · {formatMoney(c.stakeCents)} cada · {formatDateTime(c.acceptedAt)}</span></div>
          <Alert tone="danger">{c.disputeReason}</Alert>
          <div className="flex flex-wrap gap-1.5">{((c.riskFlags as string[] | null) ?? []).map((f) => <Badge key={f} tone="warn">{f === "SAME_IP" ? "mesmo IP entre as equipes" : f === "REPEATED_PAIR" ? "confrontos repetidos" : f}</Badge>)}</div>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div><dt className="text-xs text-muted">Escalação A</dt><dd>{(c.creatorLineup as unknown as LineupMember[]).map((l) => `${l.displayName} (${l.handle})`).join(", ")}</dd><dt className="mt-2 text-xs text-muted">Provas A</dt><dd>{c.evidenceA ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted">Escalação B</dt><dd>{((c.opponentLineup as unknown as LineupMember[]) ?? []).map((l) => `${l.displayName} (${l.handle})`).join(", ")}</dd><dt className="mt-2 text-xs text-muted">Provas B</dt><dd>{c.evidenceB ?? "—"}</dd></div>
          </dl>
          <ActionForm action={resolveChallengeAction} className="flex flex-wrap items-end gap-2" submit="Decidir" submitClassName="">
            <input type="hidden" name="challengeId" value={c.id} />
            <select name="outcome" className="rounded-lg border border-line bg-bg px-3 py-2.5 text-sm" aria-label="Decisão"><option value="creator">Vence {c.creatorTeam.name}</option><option value="opponent">Vence {c.opponentTeam?.name}</option><option value="void">Anular (devolver as apostas)</option></select>
            <Input name="note" required minLength={10} placeholder="Fundamento da decisão (as equipes verão)" className="w-96" />
          </ActionForm>
        </Card>
      ))}
    </div>
  );
}
