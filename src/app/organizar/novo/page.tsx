import type { Metadata } from "next";
import Link from "next/link";
import { createTournamentAction } from "@/app/actions/organizer";
import { ActionForm } from "@/components/action-form";
import { Alert, Card, Field, Input, PageTitle, Select, Textarea, buttonClass } from "@/components/ui";
import { describeStage } from "@/engine";
import { GAMES, getGame, presetsForMode } from "@/games";
import { toLocalInput } from "@/lib/dates";
import { db } from "@/lib/db";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Novo campeonato" };
export const dynamic = "force-dynamic";

export default async function NewTournamentPage({ searchParams }: { searchParams: Promise<{ org?: string; jogo?: string; modo?: string }> }) {
  const user = await requireUser("/organizar/novo");
  const sp = await searchParams;
  if (user.role === "USER") {
    return <div className="mx-auto max-w-lg"><Alert tone="warn"><b>Seu cargo é Jogador.</b> Só organizadores criam campeonatos. Peça a um administrador da plataforma para liberar o seu acesso. <Link href="/torneios" className="underline">Ver torneios</Link></Alert></div>;
  }
  // o admin cria campeonato em QUALQUER organização; o organizador, nas que é dono ou admin
  const orgList = user.role === "ADMIN"
    ? (await db.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })).map((o) => ({ orgId: o.id, org: o }))
    : await db.orgMember.findMany({ where: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } }, include: { org: true } });
  if (orgList.length === 0) {
    return <div className="mx-auto max-w-lg"><Alert tone="warn">Você precisa de uma organização para criar campeonatos. <Link href="/organizar" className="underline">Criar organização</Link></Alert></div>;
  }
  const orgId = orgList.some((m) => m.orgId === sp.org) ? sp.org! : orgList[0].orgId;
  const game = getGame(sp.jogo ?? "");
  const mode = game?.modes.find((m) => m.id === sp.modo) ?? game?.modes[0];
  const presets = game && mode ? presetsForMode(game, mode.id) : [];
  const start = new Date(Date.now() + 7 * 86400_000);
  start.setUTCMinutes(0, 0, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle title="Novo campeonato" subtitle="Escolha o jogo, o modo e um formato pronto. Depois você ajusta fases, melhor-de-N e pontuação." />
      <Card>
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" method="get">
          <Field label="Organização" htmlFor="org"><Select id="org" name="org" defaultValue={orgId}>{orgList.map((m) => <option key={m.orgId} value={m.orgId}>{m.org.name}</option>)}</Select></Field>
          <Field label="Jogo" htmlFor="jogo"><Select id="jogo" name="jogo" defaultValue={game?.id ?? ""} required><option value="">Selecione…</option>{GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
          <Field label="Modo" htmlFor="modo"><Select id="modo" name="modo" defaultValue={mode?.id ?? ""} disabled={!game}>{game ? game.modes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>) : <option>—</option>}</Select></Field>
          <button className={buttonClass("secondary")}>Continuar</button>
        </form>
        <p className="mt-2 text-xs text-muted">Se trocar o jogo, clique em Continuar para atualizar modos e formatos.</p>
      </Card>

      {game && mode && (
        <Card>
          <ActionForm action={createTournamentAction} className="space-y-6" submit="Criar campeonato (rascunho)">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="gameId" value={game.id} />
            <input type="hidden" name="modeId" value={mode.id} />

            <fieldset className="space-y-3">
              <legend className="mb-1 font-bold">1. Formato</legend>
              {presets.map((p, i) => (
                <label key={p.id} className="flex cursor-pointer gap-3 rounded-lg border border-line bg-elevated/40 p-3 has-[:checked]:border-brand has-[:checked]:bg-brand/10">
                  <input type="radio" name="presetId" value={p.id} defaultChecked={i === 0} required className="mt-1 accent-brand" />
                  <span className="text-sm">
                    <b>{p.name}</b>
                    <span className="block text-muted">{p.description}</span>
                    <span className="mt-1 block text-xs text-muted">{p.stages.map((s) => `${s.name}: ${describeStage(s.settings)}`).join(" → ")}</span>
                    <span className="mt-1 block text-xs text-accent">{p.minParticipants === p.maxParticipants ? `${p.minParticipants} participantes` : `${p.minParticipants} a ${p.maxParticipants} (ideal ${p.suggestedParticipants})`}</span>
                  </span>
                </label>
              ))}
              {presets.length === 0 && <Alert tone="warn">Nenhum formato pronto para este modo.</Alert>}
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-1 font-bold sm:col-span-2">2. Informações</legend>
              <div className="sm:col-span-2"><Field label="Nome do campeonato" htmlFor="name"><Input id="name" name="name" required minLength={4} maxLength={80} placeholder={`Copa ${game.abbr} de Primavera`} /></Field></div>
              <div className="sm:col-span-2"><Field label="Resumo (aparece nos cartões)" htmlFor="summary"><Input id="summary" name="summary" maxLength={200} /></Field></div>
              <div className="sm:col-span-2"><Field label="Descrição" htmlFor="description" hint="Aceita listas com “- ” e **negrito**."><Textarea id="description" name="description" maxLength={8000} /></Field></div>
              <Field label="Região" htmlFor="region"><Select id="region" name="region"><option value="">—</option>{game.regions.map((r) => <option key={r}>{r}</option>)}</Select></Field>
              <Field label="Plataforma" htmlFor="platform"><Select id="platform" name="platform"><option value="">Todas</option>{game.platforms.map((r) => <option key={r}>{r}</option>)}</Select></Field>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-1 font-bold sm:col-span-2">3. Datas (horário de Brasília)</legend>
              <Field label="Início do campeonato" htmlFor="startsAt"><Input id="startsAt" name="startsAt" type="datetime-local" required defaultValue={toLocalInput(start)} /></Field>
              <span />
              <Field label="Abertura das inscrições (opcional)" htmlFor="registrationOpensAt"><Input id="registrationOpensAt" name="registrationOpensAt" type="datetime-local" /></Field>
              <Field label="Encerramento das inscrições (opcional)" htmlFor="registrationClosesAt"><Input id="registrationClosesAt" name="registrationClosesAt" type="datetime-local" /></Field>
              <Field label="Abertura do check-in (padrão: 1h antes)" htmlFor="checkInOpensAt"><Input id="checkInOpensAt" name="checkInOpensAt" type="datetime-local" /></Field>
              <Field label="Encerramento do check-in (padrão: início)" htmlFor="checkInClosesAt"><Input id="checkInClosesAt" name="checkInClosesAt" type="datetime-local" /></Field>
            </fieldset>

            <fieldset className="grid gap-4 sm:grid-cols-2">
              <legend className="mb-1 font-bold sm:col-span-2">4. Vagas e valores</legend>
              <Field label="Vagas (máximo)" htmlFor="maxParticipants"><Input id="maxParticipants" name="maxParticipants" type="number" min={2} max={1024} required defaultValue={presets[0]?.suggestedParticipants ?? 16} /></Field>
              <Field label="Mínimo para começar" htmlFor="minParticipants"><Input id="minParticipants" name="minParticipants" type="number" min={2} defaultValue={presets[0]?.minParticipants ?? 2} /></Field>
              <Field label="Taxa de inscrição (R$)" htmlFor="entryFee" hint="Vazio = grátis. Pago: entre R$ 5,00 e R$ 5.000,00. O jogador paga uma taxa de serviço por cima."><Input id="entryFee" name="entryFee" inputMode="decimal" placeholder="0,00" /></Field>
              <Field label="Premiação total (R$)" htmlFor="prizePool" hint="Valor informativo; o pagamento é feito por você."><Input id="prizePool" name="prizePool" inputMode="decimal" placeholder="0,00" /></Field>
              <div className="grid grid-cols-3 gap-3 sm:col-span-2">
                <Field label="1º lugar (%)" htmlFor="split1"><Input id="split1" name="split1" type="number" min={0} max={100} defaultValue={60} /></Field>
                <Field label="2º lugar (%)" htmlFor="split2"><Input id="split2" name="split2" type="number" min={0} max={100} defaultValue={25} /></Field>
                <Field label="3º lugar (%)" htmlFor="split3"><Input id="split3" name="split3" type="number" min={0} max={100} defaultValue={15} /></Field>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 font-bold">5. Regras de operação</legend>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requireCheckIn" defaultChecked className="accent-brand" /> Exigir check-in (quem não confirmar presença sai do campeonato)</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowPlayerReporting" defaultChecked className="accent-brand" /> Capitães relatam o placar (confirmação dupla; divergência vira disputa)</label>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Seeding" htmlFor="seedingMethod"><Select id="seedingMethod" name="seedingMethod" defaultValue="RANDOM"><option value="RANDOM">Sorteio auditável</option><option value="MANUAL">Manual (você define)</option><option value="RATING">Por rating</option></Select></Field>
                <Field label="Visibilidade" htmlFor="visibility"><Select id="visibility" name="visibility"><option value="PUBLIC">Público (aparece na lista)</option><option value="UNLISTED">Não listado (só por link)</option></Select></Field>
              </div>
              {game.vetoSupported && game.mapPool && <Field label="Pool de mapas do veto (um por linha)" htmlFor="mapPool" hint={game.mapPool.note}><Textarea id="mapPool" name="mapPool" defaultValue={game.mapPool.maps.join("\n")} /></Field>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Link da transmissão" htmlFor="streamUrl"><Input id="streamUrl" name="streamUrl" type="url" placeholder="https://twitch.tv/…" /></Field>
                <Field label="Link do Discord" htmlFor="discordUrl"><Input id="discordUrl" name="discordUrl" type="url" placeholder="https://discord.gg/…" /></Field>
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 font-bold">6. Campos extras da inscrição (opcional)</legend>
              <p className="text-xs text-muted">Pergunte o que precisar (Discord, cidade, camisa…). Campos “privados” só a organização vê.</p>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-line-soft p-3 sm:grid-cols-[1.4fr_1fr_1.4fr_auto_auto] sm:items-center">
                  <Input name={`cf${i}_label`} placeholder={`Campo ${i}: rótulo`} maxLength={80} aria-label={`Rótulo do campo ${i}`} />
                  <Select name={`cf${i}_type`} aria-label="Tipo"><option value="text">Texto</option><option value="select">Lista</option><option value="checkbox">Caixa</option></Select>
                  <Input name={`cf${i}_options`} placeholder="opções, separadas, por vírgula" aria-label="Opções" />
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`cf${i}_required`} className="accent-brand" /> obrigatório</label>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" name={`cf${i}_private`} defaultChecked className="accent-brand" /> privado</label>
                </div>
              ))}
            </fieldset>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
