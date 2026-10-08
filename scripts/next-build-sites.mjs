#!/usr/bin/env node
// Passo "next build" do build para o ChatGPT Sites (chamado pelo OpenNext: veja buildCommand em open-next.config.ts).
//
// Por que existe: por causa de um padrão dinâmico de carregamento de .wasm, o Turbopack rastreia quase o projeto inteiro
// (CLI do Prisma, motores de outros bancos, playwright…) e o OpenNext empacota tudo isso: o Worker passava de 40 MiB
// (limite da Cloudflare: 3 MiB no plano grátis e 10 MiB no pago, comprimido). Depois do `next build`, as listas de rastreio
// (*.nft.json) são limpas das ferramentas de desenvolvimento que o site nunca lê, o que deixa o Worker em ~4 MiB comprimido.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
// Segredos NUNCA entram no pacote: o Next leria um .env do disco e o OpenNext o embutiria no Worker como valor padrão de qualquer
// variável ausente. No Sites os segredos ficam nas configurações do site (docs/SITES.md).
const envFiles = [".env", ".env.local", ".env.production", ".env.production.local"].filter((f) => existsSync(path.join(root, f)));
if (envFiles.length && process.env.PA_ALLOW_ENV_FILE !== "1") {
  console.error(
    `\n✖ Encontrei ${envFiles.join(", ")} na pasta do projeto. O build para o ChatGPT Sites embute esses valores no pacote publicado.\n` +
      "  Mova o arquivo para fora da pasta antes de montar (os segredos vão nas configurações do Sites).\n" +
      "  Para ignorar este aviso por sua conta e risco: PA_ALLOW_ENV_FILE=1.\n",
  );
  process.exit(1);
}

const build = spawnSync("npx", ["next", "build"], { cwd: root, stdio: "inherit", env: { ...process.env, PA_TARGET: "sites" }, shell: process.platform === "win32" });
if (build.status !== 0) process.exit(build.status ?? 1);

const JUNK = /(^|\/)node_modules\/(prisma|@prisma\/engines|@prisma\/studio-core|playwright-core|playwright|@playwright|blake3-wasm|wrangler|miniflare|typescript|vitest|@cloudflare\/workerd-[^/]+|esbuild|@esbuild|@next\/swc-[^/]+|@tailwindcss|lightningcss[^/]*|rollup|@rollup|@ast-grep|@napi-rs|tsx|@types)(\/|$)/;

function* nftFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* nftFiles(p);
    else if (name.endsWith(".nft.json")) yield p;
  }
}

let before = 0;
let after = 0;
for (const file of nftFiles(path.join(root, ".next"))) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  before += manifest.files.length;
  manifest.files = manifest.files.filter((f) => !JUNK.test(f));
  after += manifest.files.length;
  writeFileSync(file, JSON.stringify(manifest));
}
console.log(`[sites] arquivos rastreados: ${before} → ${after} (ferramentas de desenvolvimento ficam de fora do Worker)`);
