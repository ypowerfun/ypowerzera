import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O motor de transações do ChatGPT Sites (src/lib/d1-engine.ts) lê src/lib/model-meta.generated.ts para saber como desfazer cada
 * escrita. Se alguém mudar prisma/schema.prisma e esquecer de regerar, o desfazer fica errado em silêncio: este teste acusa.
 * Correção: npx prisma generate && npm run generate:meta && npm run generate:d1
 */
describe("metadados do esquema para o D1", () => {
  it("src/lib/model-meta.generated.ts está em dia com prisma/schema.prisma", () => {
    const root = path.resolve(__dirname, "..");
    let out = "";
    try {
      out = execFileSync(process.execPath, ["scripts/gen-model-meta.mjs", "--check"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      throw new Error(`model-meta desatualizado:\n${err.stdout ?? ""}${err.stderr ?? ""}\nRode: npx prisma generate && npm run generate:meta && npm run generate:d1`);
    }
    expect(out).toMatch(/em dia/);
  });
});
