/**
 * Lê o corpo de um pedido público com TETO de tamanho, sem carregar tudo na memória antes de checar: recusa pelo
 * Content-Length quando ele já passa do limite e, se o pedido não declarar o tamanho, conta os bytes à medida que chegam e
 * aborta. Os webhooks são abertos à internet: sem isso, um corpo de dezenas de MB lido por inteiro derrubaria o processo
 * (no Cloudflare Workers, o isolate tem 128 MB e os outros pedidos que estiverem nele morrem junto).
 */
export class BodyTooLargeError extends Error {
  constructor() {
    super("corpo grande demais");
  }
}

export async function readBodyLimited(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
