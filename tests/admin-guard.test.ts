import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O layout do admin não protege sozinho: uma navegação parcial (cabeçalho RSC com o estado da árvore) pula o layout e
 * renderiza só a página. Por isso TODA página (e rota) dentro de /admin precisa exigir o admin por conta própria.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("área do admin", () => {
  const root = path.resolve(__dirname, "../src/app/admin");
  const entries = walk(root).filter((f) => /(page|route)\.tsx?$/.test(f));

  it("encontra as páginas do admin", () => {
    expect(entries.length).toBeGreaterThanOrEqual(10);
  });

  it.each(entries.map((f) => [path.relative(root, f), f]))("%s exige requireAdmin() na própria página", (_name, file) => {
    expect(readFileSync(file as string, "utf8")).toMatch(/await requireAdmin\(\)/);
  });
});
