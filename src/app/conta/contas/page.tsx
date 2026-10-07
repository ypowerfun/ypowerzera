import { flatParams } from "@/lib/url";
import type { Metadata } from "next";
import { removeGameAccountAction, saveGameAccountAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, GameBadge, Input, PageTitle, Select } from "@/components/ui";
import { GAMES } from "@/games";
import { listGameAccounts } from "@/server/game-accounts";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Contas de jogo" };
export const dynamic = "force-dynamic";

export default async function GameAccountsPage({ searchParams }: { searchParams: Promise<{ jogo?: string; next?: string }> }) {
  const user = await requireUser("/conta/contas");
  const sp = flatParams(await searchParams);
  const accounts = await listGameAccounts(user.id);
  const byGame = new Map(accounts.map((a) => [a.gameId, a]));
  const ordered = [...GAMES].sort((a, b) => (a.id === sp.jogo ? -1 : b.id === sp.jogo ? 1 : 0));
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle title="Contas de jogo" subtitle="Vincule o ID que você usa em cada jogo. Ele é usado nos elencos e nas salas de partida, e cada ID só pode ficar em uma conta da plataforma." />
      {ordered.map((g) => {
        const acc = byGame.get(g.id);
        const data = (acc?.data ?? {}) as Record<string, string>;
        return (
          <Card key={g.id} id={g.id} className={g.id === sp.jogo ? "border-brand/60 shadow-glow" : ""}>
            <div className="mb-4 flex items-center gap-3">
              <GameBadge game={g} />
              <div className="flex-1"><h2 className="font-bold">{g.name}</h2>{acc && <p className="text-xs text-muted">Vinculada: {acc.handle}</p>}</div>
              {acc ? <Badge tone="ok">vinculada</Badge> : <Badge>pendente</Badge>}
            </div>
            <ActionForm action={saveGameAccountAction} className="grid gap-4 sm:grid-cols-2" submit={acc ? "Atualizar" : "Vincular conta"} submitClassName="sm:col-span-2">
              <input type="hidden" name="gameId" value={g.id} />
              {g.id === sp.jogo && sp.next && <input type="hidden" name="next" value={sp.next} />}
              {g.identity.map((f) => (
                <Field key={f.key} label={f.label} htmlFor={`${g.id}_${f.key}`} hint={f.help}>
                  {f.type === "select" ? (
                    <Select id={`${g.id}_${f.key}`} name={f.key} defaultValue={data[f.key] ?? ""} required={f.required}>
                      <option value="">Selecione…</option>
                      {f.options?.map((o) => <option key={o}>{o}</option>)}
                    </Select>
                  ) : (
                    <Input id={`${g.id}_${f.key}`} name={f.key} defaultValue={data[f.key] ?? ""} placeholder={f.placeholder} required={f.required} maxLength={120} />
                  )}
                </Field>
              ))}
            </ActionForm>
            {acc && (
              <ActionForm action={removeGameAccountAction} className="mt-3 space-y-2" submit="Remover vínculo" submitVariant="ghost" submitClassName="text-xs text-danger" confirm="Remover o vínculo desta conta de jogo?">
                <input type="hidden" name="gameId" value={g.id} />
              </ActionForm>
            )}
          </Card>
        );
      })}
    </div>
  );
}
