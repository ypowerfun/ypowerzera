import type { Metadata } from "next";
import Link from "next/link";
import { forgotPasswordAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function ForgotPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-7">
        <h1 className="text-2xl font-extrabold">Recuperar senha</h1>
        <p className="mt-1 text-sm text-muted">Informe seu e-mail e enviaremos um link para criar uma nova senha.</p>
        <ActionForm action={forgotPasswordAction} className="mt-6 space-y-4" submit="Enviar link">
          <Field label="E-mail" htmlFor="email">
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
        </ActionForm>
        <p className="mt-6 text-center text-sm"><Link href="/entrar" className="text-brand-soft hover:underline">Voltar para o login</Link></p>
      </Card>
    </div>
  );
}
