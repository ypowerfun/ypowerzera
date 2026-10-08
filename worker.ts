/**
 * Entrada do Worker no ChatGPT Sites / Cloudflare: o site gerado pelo OpenNext + a trava de subida + o agendador.
 *
 * TRAVA DE SUBIDA: no Docker o src/instrumentation.ts recusa subir com configuração perigosa ou com contas de demonstração no
 * banco. Aqui não existe "subida", então a conferência acontece NESTE ponto, que todo pedido atravessa (páginas, navegação,
 * Server Actions e rotas de API), antes de o site ver qualquer pedido. Repete a cada 5 minutos (e a cada pedido enquanto falhar).
 *
 * AGENDADOR: o OpenNext só atende pedidos HTTP (fetch). O "scheduled" abaixo é disparado pelo cron do wrangler.jsonc
 * ("triggers.crons") e chama a mesma rotina do servidor próprio (POST /api/cron/wallet). Se a hospedagem não suportar cron,
 * use um serviço externo que chame essa rota (docs/SITES.md).
 */
// @ts-expect-error o arquivo é gerado pelo build (opennextjs-cloudflare build)
import handler from "./.open-next/worker.js";
// @ts-expect-error idem
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
import { assertProductionConfig } from "./src/lib/env";

interface D1Like {
  prepare(sql: string): { first<T>(): Promise<T | null> };
}
interface Env {
  DB?: D1Like;
  CRON_SECRET?: string;
  [key: string]: unknown;
}

type Fetch = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
const siteFetch = handler.fetch as Fetch;

const RECHECK_MS = 5 * 60_000;
let checkedAt = 0;

/** null = pode atender; senão, a resposta de bloqueio (sem detalhes: o motivo vai para o log do site). */
async function gate(env: Env): Promise<Response | null> {
  if (checkedAt && Date.now() - checkedAt < RECHECK_MS) return null;
  try {
    for (const [k, v] of Object.entries(env)) if (typeof v === "string") process.env[k] = v;
    process.env.NODE_ENV ??= "production"; // este arquivo fica fora do pacote do Next, que é quem fixa o NODE_ENV
    process.env.PA_RUNTIME = "sites";
    assertProductionConfig();
    if (!env.DB) throw new Error("O banco D1 (binding DB) não está configurado.");
    try {
      const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM User WHERE email LIKE '%@primearena.local'").first<{ n: number }>();
      if (row && row.n > 0) throw new Error(`O banco tem ${row.n} conta(s) de demonstração (@primearena.local) com senha pública. Use um banco NOVO e vazio.`);
    } catch (e) {
      // só "ainda sem tabelas" (migrações não aplicadas) é aceitável aqui; qualquer outro erro do banco bloqueia
      if (!/no such table/i.test(String((e as Error)?.message))) throw e;
    }
    checkedAt = Date.now();
    return null;
  } catch (e) {
    checkedAt = 0;
    console.error("[boot-guard] BLOQUEADO:", (e as Error).message);
    return new Response("Serviço indisponível: a configuração do site está incompleta ou insegura. O dono do site deve conferir o log (docs/SITES.md).", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const blocked = await gate(env);
    if (blocked) return blocked;
    return siteFetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if ((await gate(env)) !== null) return; // configuração insegura: já registrado no log
    if (!env.CRON_SECRET) {
      console.error("[cron] CRON_SECRET não está configurado: o agendador não consegue chamar /api/cron/wallet.");
      return;
    }
    // o pedido é atendido dentro do próprio Worker (nunca sai pela rede); o endereço só precisa ser bem formado
    const request = new Request("https://cron.internal/api/cron/wallet", { method: "POST", headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
    ctx.waitUntil(
      siteFetch(request, env, ctx).then(
        (res) => {
          if (!res.ok) console.error(`[cron] /api/cron/wallet respondeu ${res.status}`);
        },
        (err) => console.error("[cron] falhou:", err instanceof Error ? err.message : err),
      ),
    );
  },
};
