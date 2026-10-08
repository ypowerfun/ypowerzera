import { assertProductionConfig, getEnv } from "@/lib/env";
import { assertNoDemoAccounts } from "./boot-checks";

const RECHECK_MS = 5 * 60_000;
let okAt = 0;
let pending: Promise<void> | null = null;

/**
 * No ChatGPT Sites não existe "subida do servidor" (cada Worker nasce no primeiro pedido, sem acesso ao banco), então as
 * mesmas travas do Docker (src/instrumentation.ts) rodam aqui, UMA vez por Worker, antes de renderizar qualquer página:
 * configuração perigosa ou contas de demonstração no banco => o site responde erro em tudo, em vez de ficar no ar inseguro.
 * No servidor próprio (Docker) isto não faz nada: lá quem confere é o instrumentation.ts.
 * É a SEGUNDA linha de defesa: a primeira fica em worker.ts, que todo pedido atravessa (inclusive Server Actions e rotas de API,
 * que não renderizam o layout). Aqui a conferência se repete a cada 5 minutos.
 */
export function ensureBootChecks(): Promise<void> {
  if (getEnv().runtime !== "sites" || (okAt && Date.now() - okAt < RECHECK_MS)) return Promise.resolve();
  pending ??= (async () => {
    try {
      assertProductionConfig();
      await assertNoDemoAccounts();
      okAt = Date.now();
    } finally {
      pending = null; // se falhou, tenta de novo no próximo pedido (a configuração pode ter sido corrigida)
    }
  })();
  return pending;
}
