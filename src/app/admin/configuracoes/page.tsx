import type { Metadata } from "next";
import { toggleWalletAction, toggleWithdrawApprovalAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, PageTitle, buttonClass } from "@/components/ui";
import { requireAdmin } from "@/server/session";
import { walletState } from "@/server/settings";

export const metadata: Metadata = { title: "Admin · Configurações", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminSettings() {
  await requireAdmin();
  const s = await walletState();
  const canEnable = !s.envBlocked && s.readiness.ready;
  const status = s.effective
    ? { tone: "ok" as const, label: "Ativa para os usuários" }
    : s.envBlocked
      ? { tone: "danger" as const, label: "Desligada no servidor (WALLET_ENABLED=false)" }
      : !s.switchOn
        ? { tone: "neutral" as const, label: "Desativada" }
        : { tone: "warn" as const, label: "Ligada, mas oculta: configuração incompleta" };
  const missing = s.readiness.items.filter((i) => !i.ok);
  return (
    <div className="space-y-6">
      <PageTitle title="Configurações" subtitle="Controle o que os usuários veem e como o dinheiro circula." />

      <Card className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Carteira de equipe, depósitos e saques</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">Esta chave controla a aba <b>Carteira</b>, os <b>depósitos por Pix</b>, os <b>saques</b> e os <b>desafios</b> valendo créditos. Desativada, a aba some e nenhuma operação nova de dinheiro é aceita. O que já estava em andamento segue o curso (Pix já pago é creditado, saque já na fila continua, desafio aceito termina).</p>
          </div>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-silver">Configuração necessária</h3>
          <ul className="divide-y divide-line-soft border border-line">
            {s.readiness.items.map((i) => (
              <li key={i.key} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-xs font-black ${i.ok ? "bg-ok/20 text-ok" : "bg-danger/20 text-danger"}`}>{i.ok ? "✓" : "✕"}</span>
                <span className="min-w-0">
                  <b>{i.label}</b>
                  <span className={`block text-xs ${i.ok ? "text-muted" : "text-danger"}`}><span className="sr-only">{i.ok ? "Pronto. " : "Pendente. "}</span>{i.hint}</span>
                </span>
              </li>
            ))}
          </ul>
          {missing.length > 0 && <p className="mt-2 text-xs text-muted">Termine estes itens no servidor (variáveis de ambiente). O passo a passo está em <code>docs/CONFIGURAR_PIX.md</code>.</p>}
        </div>

        {s.switchOn ? (
          <ActionForm action={toggleWalletAction} className="" submit="Desativar a carteira" submitVariant="danger" submitClassName="" confirm="Desativar a carteira? A aba Carteira e os Desafios somem para todos e novas operações de dinheiro ficam bloqueadas.">
            <input type="hidden" name="enabled" value="off" />
          </ActionForm>
        ) : canEnable ? (
          <ActionForm action={toggleWalletAction} className="" submit="Ativar a carteira" submitClassName="">
            <input type="hidden" name="enabled" value="on" />
          </ActionForm>
        ) : (
          <div className="space-y-2">
            <button type="button" disabled className={buttonClass("secondary")}>Ativar a carteira</button>
            <Alert tone="warn">{s.envBlocked ? "O servidor está com WALLET_ENABLED=false: ajuste a variável de ambiente para poder ativar." : "Termine as configurações pendentes acima para poder ativar. Enquanto isso a aba Carteira fica oculta para os usuários."}</Alert>
          </div>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Liberação dos saques pelo administrador</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">Com isto ligado (o padrão), <b>todo saque</b> espera a sua análise em <b>Admin → Saques</b> antes de sair, mesmo os pequenos e sem sinal de risco. Desligado, só saques pequenos e sem sinais de risco são aprovados sozinhos (os demais continuam indo para a análise).</p>
          </div>
          <Badge tone={s.withdrawRequireAdmin ? "ok" : "warn"}>{s.withdrawRequireAdmin ? "Todo saque exige o admin" : "Pequenos saques automáticos"}</Badge>
        </div>
        {s.withdrawRequireAdmin ? (
          <ActionForm action={toggleWithdrawApprovalAction} className="" submit="Permitir saques pequenos automáticos" submitVariant="secondary" submitClassName="" confirm="Desligar a liberação obrigatória? Saques pequenos e sem sinais de risco passarão a sair sem a sua análise.">
            <input type="hidden" name="required" value="off" />
          </ActionForm>
        ) : (
          <ActionForm action={toggleWithdrawApprovalAction} className="" submit="Exigir o admin em todo saque" submitClassName="">
            <input type="hidden" name="required" value="on" />
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
