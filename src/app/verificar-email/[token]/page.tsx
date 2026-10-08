import { getEnv } from "@/lib/env";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifyEmailAction } from "@/app/actions/auth";
import { Alert, ButtonLink, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Confirmar e-mail", robots: { index: false } };

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  if (getEnv().authProvider === "chatgpt") redirect("/entrar");
  const { token } = await params;
  const res = await verifyEmailAction(token);
  // E-mail de administrador: a senha é (re)criada por quem tem acesso a esta caixa de entrada, nunca por quem se cadastrou antes.
  if (res.ok && res.resetToken) redirect(`/redefinir-senha/${res.resetToken}?admin=1`);
  return (
    <div className="mx-auto max-w-md">
      <Card className="p-7 text-center">
        <h1 className="text-2xl font-extrabold">Confirmação de e-mail</h1>
        {res.ok ? <Alert tone="ok" className="mt-4">E-mail confirmado! Agora você pode se inscrever em campeonatos.</Alert> : <Alert tone="danger" className="mt-4">{res.error}</Alert>}
        <div className="mt-6"><ButtonLink href={res.ok ? "/torneios" : "/conta"}>{res.ok ? "Ver torneios" : "Ir para minha conta"}</ButtonLink></div>
      </Card>
    </div>
  );
}
