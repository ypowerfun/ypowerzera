// Cópia de segurança CONSISTENTE do banco SQLite com o site no ar (usa VACUUM INTO, que não trava o site).
//   node scripts/backup-db.mjs            → grava em <pasta do banco>/backups/primearena-AAAAMMDD-HHMM.db
//   node scripts/backup-db.mjs --keep 30  → guarda as 30 mais recentes (padrão: 14)
// No docker-compose isto roda sozinho uma vez por dia. A cópia NÃO inclui os segredos do .env (guarde o .env à parte,
// principalmente a DATA_ENCRYPTION_KEY: sem ela os CPFs cifrados do backup não abrem).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const keepArg = process.argv.indexOf("--keep");
const keep = keepArg > -1 ? Math.max(1, Number(process.argv[keepArg + 1]) || 14) : 14;

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  if (!existsSync(".env")) return "";
  return readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]*)"?/m)?.[1]?.trim() ?? "";
}

const url = databaseUrl();
if (!url.startsWith("file:")) {
  console.error("✖ Este backup é só para o banco SQLite (DATABASE_URL começando com file:).");
  process.exit(1);
}
const dbFile = path.resolve("prisma", url.slice("file:".length).split("?")[0]);
if (!existsSync(dbFile)) {
  console.error(`✖ Não achei o banco em ${dbFile}.`);
  process.exit(1);
}

const dir = path.join(path.dirname(dbFile), "backups");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
const target = path.join(dir, `primearena-${stamp}.db`);
if (/['"\\;]/.test(target)) {
  console.error("✖ O caminho do backup tem caracteres não permitidos.");
  process.exit(1);
}

const db = new PrismaClient({ datasources: { db: { url } } });
try {
  if (existsSync(target)) unlinkSync(target); // mesma hora e minuto: substitui
  await db.$executeRawUnsafe(`VACUUM INTO '${target}'`);
  console.log(`✔ Backup: ${target} (${(statSync(target).size / 1024 / 1024).toFixed(1)} MB)`);
} catch (e) {
  console.error("✖ Falhou:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}

// guarda só os mais recentes
const old = readdirSync(dir)
  .filter((f) => /^primearena-\d{8}-\d{4}\.db$/.test(f))
  .sort()
  .reverse()
  .slice(keep);
for (const f of old) unlinkSync(path.join(dir, f));
if (old.length) console.log(`• Removidos ${old.length} backup(s) antigo(s) (guardando os ${keep} mais recentes).`);
