import type { Metadata } from "next";
import { createTeamAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, PageTitle, Select, Textarea } from "@/components/ui";
import { GAMES } from "@/games";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Criar time" };

export default async function NewTeamPage() {
  await requireUser("/times/novo");
  return (
    <div className="mx-auto max-w-lg">
      <PageTitle title="Criar time" subtitle="Quem cria o time vira o capitão — e é o único que pode depositar e sacar o saldo dele." />
      <Card>
        <ActionForm action={createTeamAction} submit="Criar time">
          <Field label="Nome do time" htmlFor="name"><Input id="name" name="name" required minLength={3} maxLength={40} /></Field>
          <Field label="TAG" htmlFor="tag" hint="2 a 5 letras ou números."><Input id="tag" name="tag" required pattern="[A-Za-z0-9]{2,5}" maxLength={5} className="max-w-32 uppercase" /></Field>
          <Field label="Jogo principal (opcional)" htmlFor="gameId"><Select id="gameId" name="gameId"><option value="">Multijogos</option>{GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
          <Field label="Descrição" htmlFor="description"><Textarea id="description" name="description" maxLength={300} /></Field>
        </ActionForm>
      </Card>
    </div>
  );
}
