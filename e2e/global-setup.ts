import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

/** Recria o banco de E2E do zero (arquivo novo + db push) e popula com o seed de demonstração. */
export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");
  for (const f of ["e2e.db", "e2e.db-journal"]) {
    const p = path.join(root, "prisma", f);
    if (existsSync(p)) rmSync(p);
  }
  const env = { ...process.env, DATABASE_URL: "file:./e2e.db?connection_limit=1&socket_timeout=30" };
  execSync("npx prisma db push --skip-generate", { cwd: root, env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { cwd: root, env, stdio: "pipe" });
}
