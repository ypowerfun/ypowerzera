import { getEnv } from "@/lib/env";
import { flatParams } from "@/lib/url";
import type { Metadata } from "next";
import Link from "next/link";
import { changePasswordAction, resendVerificationAction, updateProfileAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, Field, Input, PageTitle, Textarea } from "@/components/ui";
import { requireUser } from "@/server/session";
import { getKyc } from "@/server/kyc";

export const metadata: Metadata = { title: "Minha conta" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ "boas-vindas"?: string }> }) {
  const chatgpt = getEnv().authProvider === "chatgpt";
  const user = await requireUser("/conta");
  const sp = flatParams(await searchParams);
  const kyc = await getKyc(user.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle title="Minha conta" subtitle={`@${user.username} · ${user.email}`} />
      {sp["boas-vindas"] && <Alert tone="ok">Perfil criado! Vincule suas contas de jogo para começar a se inscrever.</Alert>}
      {!chatgpt && !user.emailVerifiedAt && (
        <Alert tone="warn" className="space-y-3">
          <p>Seu e-mail ainda não foi confirmado. É necessário para se inscrever, depositar e sacar.</p>
          <ActionForm action={resendVerificationAction} className="" submit="Reenviar e-mail de confirmação" submitVariant="secondary" submitClassName="">{null}</ActionForm>
        </Alert>
      )}
      <nav className="flex flex-wrap gap-2 text-sm">
        {[["/conta/contas", "Contas de jogo"], ["/times", "Meus times"], ["/carteira", "Carteira e verificação"], ["/conta/inscricoes", "Inscrições"], ["/conta/pedidos", "Pedidos"], ["/conta/notificacoes", "Notificações"]].map(([h, l]) => (
          <Link key={h} href={h} className="rounded-lg border border-line bg-elevated px-3 py-2 font-medium text-muted hover:border-brand-soft/60 hover:text-ink">{l}</Link>
        ))}
      </nav>
      <Card>
        <div className="mb-4 flex items-center gap-2"><h2 className="font-bold">Verificação de identidade</h2>{kyc ? <Badge tone={kyc.status === "VERIFIED" ? "ok" : kyc.status === "PENDING" ? "warn" : "danger"}>{{ VERIFIED: "Verificada", PENDING: "Em análise", REJECTED: "Recusada" }[kyc.status]}</Badge> : <Badge>Não enviada</Badge>}</div>
        <p className="text-sm text-muted">Necessária para depositar, sacar e disputar desafios valendo créditos. <Link href="/carteira/verificacao" className="text-brand-soft hover:underline">{kyc ? "Ver detalhes" : "Enviar agora"}</Link></p>
      </Card>
      <Card>
        <h2 className="mb-4 font-bold">Perfil</h2>
        <ActionForm action={updateProfileAction} submit="Salvar perfil" submitClassName="">
          <Field label="Nome de exibição" htmlFor="displayName"><Input id="displayName" name="displayName" defaultValue={user.displayName} required minLength={2} maxLength={40} /></Field>
          <Field label="País (sigla)" htmlFor="country"><Input id="country" name="country" defaultValue={user.country ?? "BR"} maxLength={2} className="max-w-24 uppercase" /></Field>
          <Field label="Bio" htmlFor="bio"><Textarea id="bio" name="bio" defaultValue={user.bio ?? ""} maxLength={300} /></Field>
        </ActionForm>
      </Card>
      {chatgpt ? <Card><h2 className="font-bold">Acesso com ChatGPT</h2><p className="mt-2 text-sm text-muted">Seu login e a segurança de acesso são gerenciados pela sua conta ChatGPT.</p></Card> : <Card>
        <h2 className="mb-1 font-bold">Segurança</h2>
        <p className="mb-4 text-sm text-muted">Ao trocar a senha, as outras sessões são encerradas e os saques ficam bloqueados por 24 horas.</p>
        <ActionForm action={changePasswordAction} submit="Alterar senha" submitClassName="">
          <Field label="Senha atual" htmlFor="current"><Input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="Nova senha" htmlFor="next"><Input id="next" name="next" type="password" autoComplete="new-password" required minLength={8} /></Field>
          <Field label="Repita a nova senha" htmlFor="next2"><Input id="next2" name="next2" type="password" autoComplete="new-password" required minLength={8} /></Field>
        </ActionForm>
      </Card>}
    </div>
  );
}
