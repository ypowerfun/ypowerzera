import type { Metadata } from "next";
import { reviewKycAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Card, Empty, Input, PageTitle } from "@/components/ui";
import { ageInYears } from "@/lib/cpf";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";

export const metadata: Metadata = { title: "Admin · KYC", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminKyc() {
  const rows = await db.kycProfile.findMany({ where: { status: "PENDING" }, orderBy: { submittedAt: "asc" }, include: { user: { select: { id: true, username: true, email: true, createdAt: true, emailVerifiedAt: true } } } });
  return (
    <div className="space-y-4">
      <PageTitle title="KYC pendentes" subtitle="Confira nome completo e maioridade. O CPF só aparece com os 4 últimos dígitos (o restante fica cifrado)." />
      {rows.length === 0 ? <Empty title="Nenhum cadastro aguardando" /> : rows.map((k) => (
        <Card key={k.id} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-bold">{k.fullName}</p><p className="text-xs text-muted">@{k.user.username} · {k.user.email} {k.user.emailVerifiedAt ? "(e-mail verificado)" : "(e-mail NÃO verificado)"} · conta de {formatDate(k.user.createdAt)}</p></div>
            <div className="text-left text-sm sm:text-right"><p>CPF •••.•••.•••-{k.cpfLast4.slice(-2)} <span className="text-xs text-muted">(final {k.cpfLast4})</span></p><p className="text-xs text-muted">Nasc. {formatDate(k.birthDate, "UTC")} · {ageInYears(k.birthDate)} anos · enviado {formatDateTime(k.submittedAt)}</p></div>
          </div>
          <div className="flex flex-wrap gap-3">
            <ActionForm action={reviewKycAction} className="" submit="Aprovar" submitClassName=""><input type="hidden" name="userId" value={k.userId} /><input type="hidden" name="decision" value="approve" /></ActionForm>
            <ActionForm action={reviewKycAction} className="flex flex-wrap items-end gap-2" submit="Recusar" submitVariant="danger" submitClassName=""><input type="hidden" name="userId" value={k.userId} /><input type="hidden" name="decision" value="reject" /><Input name="reason" required minLength={5} placeholder="Motivo da recusa" className="w-64" /></ActionForm>
          </div>
        </Card>
      ))}
    </div>
  );
}
