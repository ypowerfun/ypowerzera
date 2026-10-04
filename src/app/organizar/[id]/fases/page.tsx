import type { Metadata } from "next";
import { updateStagesAction } from "@/app/actions/organizer";
import { ActionForm } from "@/components/action-form";
import { OrgNav } from "@/components/org-nav";
import { Alert, Card, Field, Input, PageTitle, Select } from "@/components/ui";
import { STAGE_TYPE_LABELS, describeStage, type StageSettings } from "@/engine";
import { formatMultipliers } from "@/lib/stage-form";
import { loadManaged } from "@/server/organizer-page";

export const metadata: Metadata = { title: "Fases", robots: { index: false } };
export const dynamic = "force-dynamic";

const Check = ({ name, label, on }: { name: string; label: string; on?: boolean }) => (
  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} defaultChecked={on} className="accent-brand" /> {label}</label>
);
const Num = ({ name, label, value, min = 1, hint }: { name: string; label: string; value?: number; min?: number; hint?: string }) => (
  <Field label={label} htmlFor={name} hint={hint}><Input id={name} name={name} type="number" min={min} step="any" defaultValue={value ?? ""} /></Field>
);

function StageFields({ s, p }: { s: StageSettings; p: string }) {
  switch (s.type) {
    case "SINGLE_ELIMINATION":
      return (
        <div className="grid gap-4 sm:grid-cols-4">
          <Num name={`${p}bo`} label="Melhor de (padrão)" value={s.bestOf.default} />
          <Num name={`${p}bo_qf`} label="Quartas" value={s.bestOf.quarterfinals} />
          <Num name={`${p}bo_sf`} label="Semifinais" value={s.bestOf.semifinals} />
          <Num name={`${p}bo_f`} label="Final" value={s.bestOf.finals} />
          <div className="sm:col-span-2"><Check name={`${p}third`} label="Disputa de 3º lugar" on={s.thirdPlaceMatch} /></div>
          <Num name={`${p}adv`} label="Avançam para a próxima fase" value={s.advancement?.count} hint="Vazio = todos (ou última fase)." />
        </div>
      );
    case "DOUBLE_ELIMINATION":
      return (
        <div className="grid gap-4 sm:grid-cols-4">
          <Num name={`${p}bo`} label="Melhor de (padrão)" value={s.bestOf.default} />
          <Num name={`${p}bo_sf`} label="Semifinais" value={s.bestOf.semifinals} />
          <Num name={`${p}bo_f`} label="Finais (W, L e GF)" value={s.bestOf.finals} />
          <Num name={`${p}adv`} label="Avançam" value={s.advancement?.count} />
          <div className="sm:col-span-4"><Check name={`${p}reset`} label="Reset da grande final (campeão da chave inferior precisa vencer 2×)" on={s.grandFinalReset} /></div>
        </div>
      );
    case "ROUND_ROBIN":
      return (
        <div className="grid gap-4 sm:grid-cols-4">
          <Num name={`${p}groups`} label="Grupos" value={s.groups} />
          <Field label="Turnos" htmlFor={`${p}legs`}><Select id={`${p}legs`} name={`${p}legs`} defaultValue={s.legs}><option value="1">Turno único</option><option value="2">Ida e volta</option></Select></Field>
          <Num name={`${p}bo`} label="Melhor de" value={s.bestOf} />
          <Num name={`${p}adv`} label="Avançam por grupo" value={s.advancement?.perGroup} />
          <Num name={`${p}pw`} label="Pontos por vitória" value={s.points.win} min={0} />
          <Num name={`${p}pd`} label="Pontos por empate" value={s.points.draw} min={0} />
          <Num name={`${p}pl`} label="Pontos por derrota" value={s.points.loss} min={0} />
          <div className="self-end"><Check name={`${p}draw`} label="Permitir empate" on={s.allowDraw} /></div>
        </div>
      );
    case "SWISS":
      return (
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Modo" htmlFor={`${p}mode`}><Select id={`${p}mode`} name={`${p}mode`} defaultValue={s.mode}><option value="winLoss">V/D (ex.: 3 vitórias / 3 derrotas)</option><option value="rounds">Rodadas fixas</option></Select></Field>
          <Num name={`${p}wins`} label="Vitórias p/ classificar" value={s.winsToAdvance} />
          <Num name={`${p}losses`} label="Derrotas p/ eliminar" value={s.lossesToEliminate} />
          <Num name={`${p}rounds`} label="Rodadas (modo fixo)" value={s.rounds} />
          <Num name={`${p}bo`} label="Melhor de" value={s.bestOf} />
          <Num name={`${p}bo_dec`} label="Melhor de (decisivas)" value={s.decisiveBestOf} />
          <Num name={`${p}adv`} label="Avançam" value={s.advancement?.count} />
          <div className="self-end"><Check name={`${p}draw`} label="Permitir empate" on={s.allowDraw} /></div>
        </div>
      );
    case "GSL":
      return (
        <div className="grid gap-4 sm:grid-cols-3">
          <Num name={`${p}bo`} label="Melhor de" value={s.bestOf} />
          <Num name={`${p}bo_dec`} label="Melhor de (vencedores/decisiva)" value={s.decisiveBestOf} />
          <Num name={`${p}adv`} label="Avançam por grupo" value={s.advancement?.perGroup} />
        </div>
      );
    case "LEADERBOARD":
      return (
        <div className="grid gap-4 sm:grid-cols-4">
          <Num name={`${p}games`} label="Partidas (teto)" value={s.games} />
          <Num name={`${p}lobby`} label="Tamanho do lobby" value={s.lobbySize} min={2} />
          <Field label="Lobbies" htmlFor={`${p}assign`}><Select id={`${p}assign`} name={`${p}assign`} defaultValue={s.lobbyAssignment}><option value="snake">Equilibrados (cobra)</option><option value="swiss">Suíço (por classificação)</option><option value="random">Sorteio a cada partida</option><option value="fixed">Fixos</option></Select></Field>
          <Num name={`${p}adv`} label="Avançam" value={s.advancement?.count} />
          <Field label="Fórmula" htmlFor={`${p}formula`}><Select id={`${p}formula`} name={`${p}formula`} defaultValue={s.scoring.formula}><option value="additive">Colocação + abates</option><option value="multiplier">Abates × multiplicador (Warzone)</option></Select></Field>
          <Num name={`${p}kill`} label="Pontos por abate" value={s.scoring.killPoints} min={0} />
          <Num name={`${p}vr`} label="Bônus de vitória" value={s.scoring.victoryBonus} min={0} />
          <Num name={`${p}mp`} label="Match point (pontos)" value={s.matchPoint?.threshold} hint="Vazio = sem match point." />
          <div className="sm:col-span-4"><Field label="Pontos por colocação (1º, 2º, 3º…)" htmlFor={`${p}placement`}><Input id={`${p}placement`} name={`${p}placement`} defaultValue={s.scoring.placementPoints.join(", ")} /></Field></div>
          <div className="sm:col-span-3"><Field label="Multiplicadores (colocação:fator)" htmlFor={`${p}mult`} hint="Ex.: 1:2, 2-5:1.8, 6-10:1.6 (use ponto nos decimais)."><Input id={`${p}mult`} name={`${p}mult`} defaultValue={formatMultipliers(s.scoring.placementMultipliers)} /></Field></div>
          <div className="self-end"><Check name={`${p}mp_win`} label="Exigir vitória após o match point" on={s.matchPoint?.requireWin ?? true} /></div>
        </div>
      );
  }
}

export default async function StagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, admin } = await loadManaged(id);
  const locked = ["LIVE", "COMPLETED", "CANCELED"].includes(t.status);
  return (
    <div>
      <PageTitle title="Fases e formato" subtitle="Ajuste melhor-de-N, avanço entre fases e pontuação. Depois que o campeonato começa, o formato fica travado." />
      <OrgNav id={id} active="/fases" />
      {locked && <Alert className="mb-4">O formato está travado porque o campeonato já começou.</Alert>}
      <ActionForm action={updateStagesAction} className="space-y-5" submit={locked || !admin ? undefined : "Salvar fases"} submitClassName="">
        <input type="hidden" name="tournamentId" value={id} />
        {t.stages.map((s) => (
          <Card key={s.id} className={locked ? "opacity-70" : ""}>
            <fieldset disabled={locked || !admin} className="space-y-4">
              <legend className="sr-only">{s.name}</legend>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label={`Fase ${s.order} — ${STAGE_TYPE_LABELS[s.type as keyof typeof STAGE_TYPE_LABELS]}`} htmlFor={`s${s.order}_name`}><Input id={`s${s.order}_name`} name={`s${s.order}_name`} defaultValue={s.name} maxLength={40} /></Field>
                <p className="text-xs text-muted">{describeStage(s.settings as never)}</p>
              </div>
              <StageFields s={s.settings as unknown as StageSettings} p={`s${s.order}_`} />
            </fieldset>
          </Card>
        ))}
      </ActionForm>
    </div>
  );
}
