#!/usr/bin/env node
// Abre o site do jeito que ele roda no ChatGPT Sites (Cloudflare Workers + banco D1), mas no seu computador:
//   npm run preview:sites
// Cria o .dev.vars com segredos novos (se ainda não existir), monta o site, prepara o banco D1 local e sobe em
// http://localhost:8787. O e-mail não sai de verdade aqui (a chave do Resend é de mentira): para confirmar a conta,
// veja docs/SITES.md ("Testar no seu computador").
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const vars = path.join(root, ".dev.vars");
if (!existsSync(vars)) {
  writeFileSync(
    vars,
    [
      "APP_URL=http://localhost:8787",
      `APP_SECRET=${randomBytes(32).toString("hex")}`,
      `CRON_SECRET=${randomBytes(24).toString("hex")}`,
      `DATA_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
      "ADMIN_EMAILS=voce@exemplo.com",
      'MAIL_FROM="Prime Arena <nao-responda@arena.exemplo.com.br>"',
      "RESEND_API_KEY=re_chave_de_mentira_apenas_local",
      "",
    ].join("\n"),
  );
  console.log("Criado .dev.vars com segredos novos (não envie este arquivo a ninguém).");
}
run("npx", ["opennextjs-cloudflare", "build"]);
run("npx", ["wrangler", "d1", "migrations", "apply", "primearena", "--local"]);
run("npx", ["wrangler", "dev", "--local", "--port", "8787"]);
