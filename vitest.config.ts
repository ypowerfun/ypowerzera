import { defineConfig } from "vitest/config";
import path from "node:path";

const src = path.resolve(__dirname, "src");
/**
 * TEST_DB=d1 roda a MESMA suíte contra um D1 de verdade (Miniflare) com o motor de transações do ChatGPT Sites
 * (src/lib/d1-engine.ts), em vez do SQLite/Prisma tradicional. Veja docs/SITES.md ("Como foi testado").
 */
const d1 = process.env.TEST_DB === "d1";

export default defineConfig({
  resolve: {
    alias: d1
      ? [
          { find: /^@prisma\/client$/, replacement: path.join(src, "generated/prisma-d1-node/client.ts") },
          { find: /^@\/lib\/db$/, replacement: path.join(src, "lib/db.d1test.ts") },
          { find: /^@\//, replacement: `${src}/` },
        ]
      : [{ find: /^@\//, replacement: `${src}/` }],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // no modo D1 ficam de fora os testes que dependem do SQLite/Node ou do próprio instalador de servidor
    exclude: d1 ? ["node_modules/**", "tests/reset-db.test.ts", "tests/installer.test.ts"] : ["node_modules/**"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
    globalSetup: d1 ? [] : ["tests/global-setup.ts"],
    setupFiles: d1 ? ["tests/setup-env.ts", "tests/setup-d1.ts"] : ["tests/setup-env.ts"],
  },
});
