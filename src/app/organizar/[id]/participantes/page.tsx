import type { Metadata } from "next";
import { dqAction, removeParticipantAction, seedingAction, setSeedAction, staffCheckInAction } from "@/app/actions/organizer";
import { ActionForm } from "@/components/action-form";
import { OrgNav } from "@/components/org-nav";
import { Badge, Empty, Input, PageTitle, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { loadManaged } from "@/server/organizer-page";
import type { CustomField, RosterMember } from "@/server/types";

export const metadata: Metadata = { title: "Participantes", robots: { index: false } };
export const dynamic = "force-dynamic";

const tone = { REGISTERED: "brand", CHECKED_IN: "ok", PENDING_PAYMENT: "warn", WAITLIST: "neutral", DISQUALIFIED: "danger", WITHDRAWN: "neutral" } as const;
const label = { REGISTERED: "Confirmado", CHECKED_IN: "Check-in", PENDING_PAYMENT: "Pagamento pendente", WAITLIST: "Fila", DISQUALIFIED: "Desclassificado", WITHDRAWN: "Saiu" } as const;

export default async function ParticipantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t } = await loadManaged(id);
  const ps = await db.participant.findMany({ where: { tournamentId: id }, orderBy: [{ seed: "asc" }, { registeredAt: "asc" }], include: { user: { select: { username: true, email: true } } } });
  const fields = (t.customFields as unknown as CustomField[] | null) ?? [];
  const before = !["LIVE", "COMPLETED", "CANCELED"].includes(t.status);
  return (
    <div>
      <PageTitle title="Participantes" subtitle={`${ps.length} inscrição(ões) · seeding ${t.seedingMethod === "RANDOM" ? "por sorteio auditável" : t.seedingMethod === "MANUAL" ? "manual" : "por rating"}.`} actions={before ? <ActionForm action={seedingAction} className="" submit="Aplicar seeding automático" submitVariant="secondary" submitClassName=""><input type="hidden" name="tournamentId" value={id} /></ActionForm> : null} />
      <OrgNav id={id} active="/participantes" />
      {ps.length === 0 ? <Empty title="Ninguém inscrito ainda" /> : (
        <Table>
          <thead><tr><Th>Seed</Th><Th>Participante</Th><Th>Elenco</Th><Th>Situação</Th>{fields.length > 0 && <Th>Respostas</Th>}<Th>Ações</Th></tr></thead>
          <tbody>
            {ps.map((p) => {
              const answers = (p.customAnswers as Record<string, string> | null) ?? {};
              return (
                <tr key={p.id}>
                  <Td>
                    {before ? (
                      <ActionForm action={setSeedAction} className="flex items-center gap-1" submit="OK" submitVariant="ghost" submitClassName="px-2 py-1 text-xs">
                        <input type="hidden" name="tournamentId" value={id} /><input type="hidden" name="participantId" value={p.id} />
                        <Input name="seed" type="number" min={1} max={1024} defaultValue={p.seed ?? ""} className="w-16 px-2 py-1" aria-label={`Seed de ${p.name}`} />
                      </ActionForm>
                    ) : <b>{p.seed ?? "—"}</b>}
                  </Td>
                  <Td><b>{p.name}</b> {p.tag && <span className="text-xs text-muted">[{p.tag}]</span>}<span className="block text-xs text-muted">{p.user.username}</span></Td>
                  <Td className="text-xs text-muted">{(p.roster as unknown as RosterMember[]).map((r) => `${r.displayName} (${r.handle}${r.identity.discord ? ` · ${r.identity.discord}` : ""})${r.role === "sub" ? " ·reserva" : ""}`).join(", ")}</Td>
                  <Td><Badge tone={tone[p.status]}>{label[p.status]}</Badge>{p.dqReason && <span className="block text-xs text-muted">{p.dqReason}</span>}{p.finalPlacement && <span className="block text-xs font-bold text-accent">{p.finalPlacement}º lugar</span>}</Td>
                  {fields.length > 0 && <Td className="text-xs text-muted">{fields.map((f) => answers[f.key] ? `${f.label}: ${answers[f.key]}` : null).filter(Boolean).join(" · ")}</Td>}
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {before && ["REGISTERED", "CHECKED_IN"].includes(p.status) && (
                        <ActionForm action={staffCheckInAction} className="" submit={p.status === "CHECKED_IN" ? "Desfazer check-in" : "Check-in"} submitVariant="ghost" submitClassName="px-2 py-1 text-xs"><input type="hidden" name="tournamentId" value={id} /><input type="hidden" name="participantId" value={p.id} />{p.status === "CHECKED_IN" && <input type="hidden" name="undo" value="1" />}</ActionForm>
                      )}
                      {before && !["WITHDRAWN", "DISQUALIFIED"].includes(p.status) && (
                        <ActionForm action={removeParticipantAction} className="" submit="Remover" submitVariant="ghost" submitClassName="px-2 py-1 text-xs text-danger" confirm="Remover esta inscrição? (reembolso automático)"><input type="hidden" name="tournamentId" value={id} /><input type="hidden" name="participantId" value={p.id} /></ActionForm>
                      )}
                      {!["DISQUALIFIED", "WITHDRAWN", "WAITLIST"].includes(p.status) && (
                        <details><summary className="cursor-pointer px-2 py-1 text-xs text-danger">Desclassificar</summary>
                          <ActionForm action={dqAction} className="mt-2 flex gap-1" submit="Confirmar" submitVariant="danger" submitClassName="px-2 py-1 text-xs"><input type="hidden" name="tournamentId" value={id} /><input type="hidden" name="participantId" value={p.id} /><Input name="reason" required minLength={3} placeholder="motivo" className="w-40 px-2 py-1" /></ActionForm>
                        </details>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
