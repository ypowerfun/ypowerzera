// Prepara o ambiente local em qualquer sistema (Windows, macOS, Linux): .env, banco SQLite e dados de demonstração.
//   npm run setup               → prepara tudo (seguro rodar de novo)
//   node scripts/setup.mjs --if-needed → usado pelo `npm run dev`: só age se faltar o .env ou o banco
import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ifNeeded = process.argv.includes("--if-needed");
const DEFAULT_DB_URL = 'DATABASE_URL="file:./dev.db?connection_limit=1&socket_timeout=30"';

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n✖ Node ${process.versions.node} é antigo demais. Este projeto precisa do Node 22.13 ou superior (https://nodejs.org).`);
  process.exit(1);
}

function databaseUrl() {
  if (!existsSync(".env")) return "";
  return readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]*)"?/m)?.[1]?.trim() ?? "";
}

function needsSetup() {
  const url = databaseUrl();
  if (!url) return true; // sem .env, ou .env sem DATABASE_URL
  if (!url.startsWith("file:")) return false; // banco externo (Postgres…): não é com este script
  return !existsSync(path.resolve("prisma", url.slice("file:".length).split("?")[0])); // SQLite é relativo à pasta do schema
}

/** Roda em silêncio; só mostra a saída se falhar. */
function quiet(label, cmd, args) {
  const r = spawnSync(cmd, args, { shell: true, encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`\n✖ Falhou: ${label}\n${r.stdout ?? ""}${r.stderr ?? ""}`);
    process.exit(r.status ?? 1);
  }
}

if (ifNeeded) {
  if (!needsSetup()) {
    // Ambiente já existe: só mantém o banco e o cliente em dia com o esquema (atualizações do projeto adicionam tabelas/colunas).
    // Mudanças que apagariam dados NÃO são aplicadas sozinhas: o Prisma recusa e o erro aparece aqui.
    if (databaseUrl().startsWith("file:")) {
      quiet("Atualizando o esquema do banco", "npx", ["prisma", "db", "push", "--skip-generate"]);
      quiet("Atualizando o cliente do banco", "npx", ["prisma", "generate"]);
      // renomeia, só se existirem, os nomes antigos dos dados de demonstração (textos exatos da própria seed).
      // É só cosmético: se falhar, avisa e segue — nunca impede o site de subir.
      const r = spawnSync("npx", ["tsx", "prisma/refresh-demo.ts"], { shell: true, encoding: "utf8" });
      if (r.status !== 0) console.warn(`\n⚠ Não foi possível atualizar os nomes dos dados de demonstração (o site sobe normalmente):\n${(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join("\n")}`);
      else if (r.stdout?.trim()) console.log(r.stdout.trim());
    }
    process.exit(0);
  }
  console.log("\n• Primeira execução neste computador: preparando o ambiente (leva menos de um minuto)…");
}

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("✔ Criado .env a partir do .env.example (os padrões servem para desenvolvimento).");
} else if (!databaseUrl()) {
  appendFileSync(".env", `\n${DEFAULT_DB_URL}\n`);
  console.log("✔ Adicionado DATABASE_URL ao .env existente.");
} else {
  console.log("• .env já existe — mantido como está.");
}

function run(label, cmd, args) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`\n✖ Falhou: ${label}`);
    process.exit(r.status ?? 1);
  }
}

run("Gerando o cliente do banco", "npx", ["prisma", "generate"]);
run("Criando as tabelas (SQLite em prisma/dev.db)", "npx", ["prisma", "db", "push", "--skip-generate"]);
run("Carregando dados de demonstração", "npx", ["tsx", "prisma/seed.ts"]);

console.log(ifNeeded ? "\n✔ Ambiente pronto — iniciando o site…\n" : "\n✔ Pronto. Agora rode:  npm run dev   e abra  http://localhost:3000");
console.log("  Logins (senha Prime#Arena2026): admin@primearena.local · organizador@primearena.local · lider1@primearena.local · jogador1@primearena.local");
