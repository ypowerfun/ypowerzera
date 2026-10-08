/**
 * Entrada do Worker no ChatGPT Sites / Cloudflare: o site gerado pelo OpenNext + o agendador.
 * O OpenNext só sabe atender pedidos HTTP (fetch); aqui acrescentamos o "scheduled", que a Cloudflare dispara pelo cron
 * do wrangler.jsonc ("triggers.crons") e que chama a mesma rotina do servidor próprio (POST /api/cron/wallet).
 * Se a hospedagem não suportar cron, use um serviço externo que chame essa rota (docs/SITES.md).
 */
// @ts-expect-error o arquivo é gerado pelo build (opennextjs-cloudflare build)
import handler from "./.open-next/worker.js";
// @ts-expect-error idem
export { BucketCachePurge, DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

interface Env {
  APP_URL?: string;
  CRON_SECRET?: string;
  [key: string]: unknown;
}

export default {
  fetch: handler.fetch as (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.CRON_SECRET || !env.APP_URL) return; // sem segredo não há como autenticar a chamada
    const request = new Request(`${env.APP_URL.replace(/\/$/, "")}/api/cron/wallet`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    });
    ctx.waitUntil(
      (handler.fetch as (r: Request, e: Env, c: ExecutionContext) => Promise<Response>)(request, env, ctx).then(
        (res) => {
          if (!res.ok) console.error(`[cron] /api/cron/wallet respondeu ${res.status}`);
        },
        (err) => console.error("[cron] falhou:", err instanceof Error ? err.message : err),
      ),
    );
  },
};
