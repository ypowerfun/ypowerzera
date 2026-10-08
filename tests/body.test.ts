import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readBodyLimited } from "@/lib/body";

describe("leitura de corpo com teto (webhooks públicos)", () => {
  const req = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request("https://x.test/w", { method: "POST", body, headers });

  it("corpo pequeno passa inteiro, com acentos", async () => {
    expect(await readBodyLimited(req('{"nome":"São João"}'), 1000)).toBe('{"nome":"São João"}');
    expect(await readBodyLimited(req(null), 1000)).toBe("");
  });

  it("recusa pelo Content-Length declarado, sem ler o corpo", async () => {
    const r = new Request("https://x.test/w", { method: "POST", body: "x".repeat(10), headers: { "content-length": "5000000" } });
    await expect(readBodyLimited(r, 1000)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("sem tamanho declarado, conta os bytes que chegam e aborta ao passar do teto", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode("a".repeat(400)));
        if (pulled > 1000) controller.close();
      },
    });
    const r = new Request("https://x.test/w", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readBodyLimited(r, 1000)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(pulled).toBeLessThan(10); // parou cedo: não leu o corpo inteiro
  });
});
