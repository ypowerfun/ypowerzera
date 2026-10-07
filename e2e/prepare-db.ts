import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Recria o banco de E2E do zero (arquivo novo + db push) e popula com o seed de demonstração.
 * Roda ANTES de o servidor subir (veja `webServer.command`): o Playwright inicia o servidor antes do globalSetup, e as
 * páginas já consultam o banco (cabeçalho e rodapé leem a chave da carteira) — um banco antigo ou apagado no meio quebraria tudo.
 */
const root = path.resolve(__dirname, "..");
const url = process.env.DATABASE_URL;
if (!url?.includes("e2e.db")) throw new Error("prepare-db só roda contra o banco de E2E (DATABASE_URL com e2e.db).");
for (const f of ["e2e.db", "e2e.db-journal"]) {
  const p = path.join(root, "prisma", f);
  if (existsSync(p)) rmSync(p);
}
execSync("npx prisma db push --skip-generate", { cwd: root, env: process.env, stdio: "pipe" });
execSync("npx tsx prisma/seed.ts", { cwd: root, env: process.env, stdio: "pipe" });
