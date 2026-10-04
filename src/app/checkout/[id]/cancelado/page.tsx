import type { Metadata } from "next";
import { Alert, ButtonLink, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Pagamento cancelado", robots: { index: false } };

export default function CanceledPage() {
  return (
    <div className="mx-auto max-w-md">
      <Card className="space-y-4 p-7 text-center">
        <h1 className="text-2xl font-extrabold">Pagamento não concluído</h1>
        <Alert tone="warn">Nenhum valor foi cobrado. Sua vaga fica reservada por até 30 minutos desde o início da inscrição; depois é liberada.</Alert>
        <ButtonLink href="/torneios" variant="secondary">Ver torneios</ButtonLink>
      </Card>
    </div>
  );
}
