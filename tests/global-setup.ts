import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export default function setup() {
  const dir = path.resolve(__dirname, "../.test-db");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "test.db");
  rmSync(file, { force: true });
  rmSync(`${file}-journal`, { force: true });
  writeFileSync(file, ""); // Prisma 6 requires an existing SQLite file in this runtime.
  // O arquivo é apagado acima, então um `db push` comum já cria o schema do zero (sem --force-reset).
  execSync("npx prisma db push --skip-generate", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: `file:${file}` },
  });
}
