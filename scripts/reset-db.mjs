// Volta o banco LOCAL ao estado de fábrica: apaga TUDO (contas, equipes, campeonatos, saldos, pedidos, mensagens...) e
// recria só os dados de demonstração, ou seja, apenas as contas padrão. Funciona igual no Windows, macOS e Linux.
//   npm run reset                → pergunta antes (digite RESETAR)
//   npm run reset -- --yes       → sem perguntar
//   npm run reset -- --no-backup → não guarda a cópia de segurança
//   npm run reset -- --force     → não confere se o site está rodando
// Antes de apagar, guarda uma cópia do banco em prisma/backups/. Só mexe em banco SQLite local (nunca em produção).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import readline from "node:readline/promises";

const args = new Set(process.argv.slice(2));
const yes = args.has("--yes");
const noBackup = args.has("--no-backup");
const force = args.has("--force");

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n✖ Node ${process.versions.node} é antigo demais. Este projeto precisa do Node 22.13 ou superior (https://nodejs.org).`);
  process.exit(1);
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  if (!existsSync(".env")) return "";
  return readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]*)"?/m)?.[1]?.trim() ?? "";
}

if (process.env.NODE_ENV === "production") fail("Recusado: NODE_ENV=production. Este comando só reinicia o banco local de desenvolvimento.");
const url = databaseUrl();
if (!url) fail("Não achei o DATABASE_URL (arquivo .env). Rode primeiro:  npm run setup");
if (!url.startsWith("file:")) fail("Recusado: o banco não é um arquivo SQLite local. Este comando só reinicia o banco de desenvolvimento (SQLite).");
const dbFile = path.resolve("prisma", url.slice("file:".length).split("?")[0]); // SQLite é relativo à pasta do schema

/** O site aberto segura o arquivo do banco: se estiver rodando, o reset "não pegaria" (ou travaria no Windows). */
function siteRunning(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(500, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

if (!force) {
  const port = Number(process.env.PORT) || 3000;
  if (await siteRunning(port)) {
    fail(`O site parece estar rodando (porta ${port}). Feche-o antes (Ctrl+C no terminal do "npm run dev") e rode o reset de novo.\n  Se tiver certeza de que não é o site, use:  npm run reset -- --force`);
  }
}

console.log("\nVoltar ao estado de fábrica");
console.log(`  Banco: ${dbFile}`);
console.log("  • APAGA tudo: contas criadas por você ou por outras pessoas, equipes, campeonatos, saldos, pedidos, notificações.");
console.log("  • Recria só as contas padrão da demonstração (admin, organizador, líderes 1-4, jogadores 1-6) com a senha de sempre.");
console.log(noBackup ? "  • Sem cópia de segurança (--no-backup)." : "  • Antes disso guarda uma cópia do banco em prisma/backups/.");

if (!yes) {
  if (!process.stdin.isTTY) fail("Sem terminal interativo para confirmar. Use:  npm run reset -- --yes");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('\nPara confirmar, digite RESETAR e aperte Enter (qualquer outra coisa cancela): ')).trim();
  rl.close();
  if (answer !== "RESETAR") {
    console.log("\nCancelado. Nada foi alterado.\n");
    process.exit(0);
  }
}

if (!noBackup && existsSync(dbFile)) {
  const dir = path.resolve("prisma", "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const backup = path.join(dir, `${path.basename(dbFile, ".db")}-${stamp}.db`);
  copyFileSync(dbFile, backup);
  console.log(`\n✔ Cópia de segurança: ${path.relative(process.cwd(), backup)}`);
}

for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  try {
    rmSync(dbFile + suffix, { force: true });
  } catch (e) {
    fail(`Não consegui apagar ${dbFile + suffix} (${e.code ?? e.message}). Provavelmente o site ainda está aberto: feche-o (Ctrl+C no "npm run dev") e tente de novo.`);
  }
}
console.log("✔ Banco antigo apagado.");

function run(label, cmd, cmdArgs) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: true, env: { ...process.env, DATABASE_URL: url } });
  if (r.status !== 0) fail(`Falhou: ${label}. O banco antigo está na cópia de segurança (prisma/backups/), se você não usou --no-backup.`);
}

run("Criando as tabelas", "npx", ["prisma", "db", "push", "--skip-generate"]);
run("Carregando as contas e os dados padrão", "npx", ["tsx", "prisma/seed.ts"]);

console.log("\n✔ Pronto: só as contas padrão restaram. Inicie o site de novo com:  npm run dev");
console.log("  Logins (senha Prime#Arena2026): admin@primearena.local · organizador@primearena.local · lider1@primearena.local · jogador1@primearena.local\n");
