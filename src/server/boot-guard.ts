import { assertProductionConfig } from "@/lib/env";
import { assertNoDemoAccounts } from "./boot-checks";

let ok = false;
let pending: Promise<void> | null = null;

/**
 * No ChatGPT Sites não existe "subida do servidor" (cada Worker nasce no primeiro pedido, sem acesso ao banco), então as
 * mesmas travas do Docker (src/instrumentation.ts) rodam aqui, UMA vez por Worker, antes de renderizar qualquer página:
 * configuração perigosa ou contas de demonstração no banco => o site responde erro em tudo, em vez de ficar no ar inseguro.
 * No servidor próprio (Docker) isto não faz nada: lá quem confere é o instrumentation.ts.
 */
export function ensureBootChecks(): Promise<void> {
  if (process.env.PA_RUNTIME !== "sites" || ok) return Promise.resolve();
  pending ??= (async () => {
    try {
      assertProductionConfig();
      await assertNoDemoAccounts();
      ok = true;
    } finally {
      pending = null; // se falhou, tenta de novo no próximo pedido (a configuração pode ter sido corrigida)
    }
  })();
  return pending;
}
