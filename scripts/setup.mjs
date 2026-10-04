// Prepara o ambiente local em qualquer sistema (Windows, macOS, Linux): .env, banco SQLite e dados de demonstração.
// Uso: npm install && npm run setup && npm run dev
import { copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n✖ Node ${process.versions.node} é antigo demais. Este projeto precisa do Node 22.13 ou superior (https://nodejs.org).`);
  process.exit(1);
}

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("✔ Criado .env a partir do .env.example (os padrões servem para desenvolvimento).");
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

console.log("\n✔ Pronto. Agora rode:  npm run dev   e abra  http://localhost:3000");
console.log("  Logins (senha Prime#Arena2026): admin@primearena.local · organizador@primearena.local · lider1@primearena.local · jogador1@primearena.local");
