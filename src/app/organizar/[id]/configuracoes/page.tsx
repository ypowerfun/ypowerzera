import type { Metadata } from "next";
import { updateTournamentAction } from "@/app/actions/organizer";
import { ActionForm } from "@/components/action-form";
import { OrgNav } from "@/components/org-nav";
import { Alert, Card, Field, Input, PageTitle, Select, Textarea } from "@/components/ui";
import { getGame } from "@/games";
import { toLocalInput } from "@/lib/dates";
import { loadManaged } from "@/server/organizer-page";

export const metadata: Metadata = { title: "Configurações", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, admin } = await loadManaged(id);
  const game = getGame(t.gameId)!;
  const locked = ["COMPLETED", "CANCELED"].includes(t.status);
  const started = t.status === "LIVE";
  return (
    <div>
      <PageTitle title="Configurações" subtitle="Dados do campeonato. Taxa e vagas não mudam depois que há inscritos." />
      <OrgNav id={id} active="/configuracoes" />
      {!admin && <Alert className="mb-4">Somente donos e administradores da organização editam as configurações.</Alert>}
      {locked && <Alert className="mb-4">Campeonato encerrado: edição desativada.</Alert>}
      <Card>
        <ActionForm action={updateTournamentAction} className="space-y-5" submit={admin && !locked ? "Salvar" : undefined} submitClassName="">
          <input type="hidden" name="tournamentId" value={id} />
          <fieldset disabled={!admin || locked} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Nome" htmlFor="name"><Input id="name" name="name" defaultValue={t.name} required minLength={4} maxLength={80} /></Field></div>
            <div className="sm:col-span-2"><Field label="Resumo" htmlFor="summary"><Input id="summary" name="summary" defaultValue={t.summary ?? ""} maxLength={200} /></Field></div>
            <div className="sm:col-span-2"><Field label="Descrição" htmlFor="description"><Textarea id="description" name="description" defaultValue={t.description ?? ""} maxLength={8000} /></Field></div>
            <div className="sm:col-span-2"><Field label="Regulamento" htmlFor="rules" hint="Listas com “- ” e **negrito**. Vazio = regulamento padrão do jogo."><Textarea id="rules" name="rules" defaultValue={t.rules ?? ""} className="min-h-48" maxLength={20000} /></Field></div>
            <Field label="Início" htmlFor="startsAt"><Input id="startsAt" name="startsAt" type="datetime-local" defaultValue={toLocalInput(t.startsAt)} /></Field>
            <span />
            <Field label="Abertura das inscrições" htmlFor="registrationOpensAt"><Input id="registrationOpensAt" name="registrationOpensAt" type="datetime-local" defaultValue={toLocalInput(t.registrationOpensAt)} /></Field>
            <Field label="Encerramento das inscrições" htmlFor="registrationClosesAt"><Input id="registrationClosesAt" name="registrationClosesAt" type="datetime-local" defaultValue={toLocalInput(t.registrationClosesAt)} /></Field>
            <Field label="Abertura do check-in" htmlFor="checkInOpensAt"><Input id="checkInOpensAt" name="checkInOpensAt" type="datetime-local" defaultValue={toLocalInput(t.checkInOpensAt)} /></Field>
            <Field label="Encerramento do check-in" htmlFor="checkInClosesAt"><Input id="checkInClosesAt" name="checkInClosesAt" type="datetime-local" defaultValue={toLocalInput(t.checkInClosesAt)} /></Field>
            {!started && <><Field label="Vagas (máximo)" htmlFor="maxParticipants"><Input id="maxParticipants" name="maxParticipants" type="number" min={2} defaultValue={t.maxParticipants} /></Field>
            <Field label="Mínimo para começar" htmlFor="minParticipants"><Input id="minParticipants" name="minParticipants" type="number" min={2} defaultValue={t.minParticipants} /></Field>
            <Field label="Taxa de inscrição (R$)" htmlFor="entryFee" hint="Só pode mudar antes de existir inscrição."><Input id="entryFee" name="entryFee" inputMode="decimal" defaultValue={t.entryFeeCents ? (t.entryFeeCents / 100).toFixed(2).replace(".", ",") : ""} /></Field></>}
            <Field label="Premiação total (R$)" htmlFor="prizePool"><Input id="prizePool" name="prizePool" inputMode="decimal" defaultValue={t.prizePoolCents ? (t.prizePoolCents / 100).toFixed(2).replace(".", ",") : ""} /></Field>
            <Field label="Região" htmlFor="region"><Select id="region" name="region" defaultValue={t.region ?? ""}><option value="">—</option>{game.regions.map((r) => <option key={r}>{r}</option>)}</Select></Field>
            <Field label="Plataforma" htmlFor="platform"><Select id="platform" name="platform" defaultValue={t.platform ?? ""}><option value="">Todas</option>{game.platforms.map((r) => <option key={r}>{r}</option>)}</Select></Field>
            <Field label="Visibilidade" htmlFor="visibility"><Select id="visibility" name="visibility" defaultValue={t.visibility}><option value="PUBLIC">Público</option><option value="UNLISTED">Não listado</option></Select></Field>
            <Field label="Transmissão" htmlFor="streamUrl"><Input id="streamUrl" name="streamUrl" type="url" defaultValue={t.streamUrl ?? ""} /></Field>
            <Field label="Discord" htmlFor="discordUrl"><Input id="discordUrl" name="discordUrl" type="url" defaultValue={t.discordUrl ?? ""} /></Field>
            {game.vetoSupported && <div className="sm:col-span-2"><Field label="Pool de mapas do veto (um por linha)" htmlFor="mapPool"><Textarea id="mapPool" name="mapPool" defaultValue={((t.mapPool as unknown as string[] | null) ?? game.mapPool?.maps ?? []).join("\n")} /></Field></div>}
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="allowPlayerReporting" defaultChecked={t.allowPlayerReporting} className="accent-brand" /> Capitães relatam o placar</label>
          </fieldset>
        </ActionForm>
      </Card>
    </div>
  );
}
