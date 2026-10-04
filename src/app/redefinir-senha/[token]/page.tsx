import type { Metadata } from "next";
import { resetPasswordAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Alert, Card, Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Nova senha", robots: { index: false } };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-7">
        <h1 className="text-2xl font-extrabold">Criar nova senha</h1>
        <Alert tone="warn" className="mt-4">Por segurança, depois de redefinir a senha os saques da carteira ficam bloqueados por 24 horas.</Alert>
        <ActionForm action={resetPasswordAction} className="mt-5 space-y-4" submit="Salvar nova senha">
          <input type="hidden" name="token" value={token} />
          <Field label="Nova senha" htmlFor="password"><Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
          <Field label="Repita a nova senha" htmlFor="password2"><Input id="password2" name="password2" type="password" required minLength={8} autoComplete="new-password" /></Field>
        </ActionForm>
      </Card>
    </div>
  );
}
