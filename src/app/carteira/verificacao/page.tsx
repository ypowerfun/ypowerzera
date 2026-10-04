import type { Metadata } from "next";
import { submitKycAction } from "@/app/actions/wallet";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, Field, Input, PageTitle } from "@/components/ui";
import { getKyc } from "@/server/kyc";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Verificação de identidade" };
export const dynamic = "force-dynamic";

export default async function KycPage() {
  const user = await requireUser("/carteira/verificacao");
  const kyc = await getKyc(user.id);
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageTitle title="Verificação de identidade" subtitle="Exigida para depositar, sacar e disputar desafios valendo créditos." />
      {kyc && (
        <Card className="space-y-2">
          <div className="flex items-center gap-2"><h2 className="font-bold">Situação</h2><Badge tone={kyc.status === "VERIFIED" ? "ok" : kyc.status === "PENDING" ? "warn" : "danger"}>{{ VERIFIED: "Verificada", PENDING: "Em análise", REJECTED: "Recusada" }[kyc.status]}</Badge></div>
          <p className="text-sm text-muted">{kyc.fullName} · CPF final {kyc.cpfLast4}</p>
          {kyc.status === "REJECTED" && kyc.rejectReason && <Alert tone="danger">Motivo: {kyc.rejectReason}. Corrija os dados e envie novamente.</Alert>}
        </Card>
      )}
      {kyc?.status !== "VERIFIED" && (
        <Card>
          <ActionForm action={submitKycAction} submit={kyc ? "Reenviar dados" : "Enviar para verificação"}>
            <Field label="Nome completo (como no documento)" htmlFor="fullName"><Input id="fullName" name="fullName" required minLength={5} maxLength={80} autoComplete="name" defaultValue={kyc?.fullName ?? ""} /></Field>
            <Field label="CPF" htmlFor="cpf" hint="Deve ser do titular da conta. Cada CPF só pode ser usado em uma conta."><Input id="cpf" name="cpf" required inputMode="numeric" placeholder="000.000.000-00" autoComplete="off" /></Field>
            <Field label="Data de nascimento" htmlFor="birthDate" hint="Apenas maiores de 18 anos."><Input id="birthDate" name="birthDate" type="date" required autoComplete="bday" /></Field>
            <p className="text-xs text-muted">Seus dados são usados somente para verificar a identidade, validar o titular dos Pix de depósito e enviar saques ao seu CPF. O CPF é guardado cifrado (AES-256-GCM).</p>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
