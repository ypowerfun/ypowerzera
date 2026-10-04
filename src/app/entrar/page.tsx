import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Alert, Card, Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; "senha-redefinida"?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-7">
        <h1 className="text-2xl font-extrabold">Entrar</h1>
        <p className="mt-1 text-sm text-muted">Acesse seus campeonatos, times e carteira.</p>
        {sp["senha-redefinida"] && <Alert tone="ok" className="mt-4">Senha redefinida. Entre com a nova senha.</Alert>}
        <ActionForm action={loginAction} className="mt-6 space-y-4" submit="Entrar">
          <input type="hidden" name="next" value={sp.next ?? ""} />
          <Field label="E-mail ou usuário" htmlFor="identifier">
            <Input id="identifier" name="identifier" autoComplete="username" required autoFocus />
          </Field>
          <Field label="Senha" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <div className="text-right text-sm">
            <Link href="/recuperar-senha" className="text-brand-soft hover:underline">Esqueci minha senha</Link>
          </div>
        </ActionForm>
        <p className="mt-6 text-center text-sm text-muted">
          Ainda não tem conta? <Link href="/cadastro" className="font-semibold text-brand-soft hover:underline">Criar conta</Link>
        </p>
      </Card>
    </div>
  );
}
