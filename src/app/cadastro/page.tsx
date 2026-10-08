import type { Metadata } from "next";
import Link from "next/link";
import { registerAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { getEnv } from "@/lib/env";
import { getChatGPTUser, chatGPTSignInPath } from "@/server/chatgpt-auth";
import { findChatGPTProfile } from "@/server/chatgpt-users";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/action-helpers";
import { flatParams } from "@/lib/url";
import { Card, Field, Input } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Criar conta" };

export default async function RegisterPage({searchParams}: {searchParams: Promise<{next?: string}>}) {
  if (getEnv().authProvider === "chatgpt") {
    const next = safeNext(flatParams(await searchParams).next || "/conta");
    const identity = await getChatGPTUser();
    if (identity && await findChatGPTProfile(identity)) redirect(next);
    return <div className="mx-auto max-w-md"><Card className="p-7">
      <h1 className="text-2xl font-extrabold">Seu perfil de jogador</h1>
      {identity ? <ActionForm action={registerAction} className="mt-6 space-y-4" submit="Criar perfil">
        <input type="hidden" name="next" value={next} />
        <Field label="Nome de exibição" htmlFor="displayName"><Input id="displayName" name="displayName" defaultValue={identity.fullName?.slice(0,40) ?? ""} required minLength={2} maxLength={40} /></Field>
        <Field label="Nome de usuário" htmlFor="username" hint="3 a 20 caracteres: letras, números e _. "><Input id="username" name="username" required pattern="[A-Za-z0-9_]{3,20}" /></Field>
        <label className="flex gap-2 text-sm text-muted"><input type="checkbox" name="terms" required /><span>Li e aceito os termos de uso e a política de privacidade.</span></label>
      </ActionForm> : <><p className="mt-3 text-muted">Entre com sua conta ChatGPT para escolher seu nome de jogador.</p><a href={chatGPTSignInPath(`/cadastro?next=${encodeURIComponent(next)}`)} target="_top" className="mt-6 block rounded-lg bg-brand px-5 py-3 text-center font-bold text-white">Continuar com ChatGPT</a></>}
    </Card></div>;
  }
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-7">
        <h1 className="text-2xl font-extrabold">Criar conta</h1>
        <p className="mt-1 text-sm text-muted">Gratuito. Leva menos de um minuto.</p>
        <ActionForm action={registerAction} className="mt-6 space-y-4" submit="Criar conta">
          <Field label="Nome de exibição" htmlFor="displayName">
            <Input id="displayName" name="displayName" required minLength={2} maxLength={40} autoComplete="nickname" />
          </Field>
          <Field label="Nome de usuário" htmlFor="username" hint="3 a 20 caracteres: letras, números e _.">
            <Input id="username" name="username" required pattern="[A-Za-z0-9_]{3,20}" autoComplete="username" />
          </Field>
          <Field label="E-mail" htmlFor="email">
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Senha" htmlFor="password" hint="Mínimo de 8 caracteres. Evite senhas comuns.">
            <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <Field label="Repita a senha" htmlFor="password2">
            <Input id="password2" name="password2" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <label className="flex items-start gap-2 text-sm text-muted">
            <input type="checkbox" name="terms" className="mt-1 accent-brand" required />
            <span>Li e aceito os termos de uso e a política de privacidade.</span>
          </label>
        </ActionForm>
        <p className="mt-6 text-center text-sm text-muted">
          Já tem conta? <Link href="/entrar" className="font-semibold text-brand-soft hover:underline">Entrar</Link>
        </p>
      </Card>
    </div>
  );
}
