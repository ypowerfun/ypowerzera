// Monta o .zip para entregar (ChatGPT Sites ou servidor): SÓ os arquivos versionados no git (HEAD).
//   npm run empacotar            → entrega/prime-arena-AAAA-MM-DD-<commit>.zip
//   npm run empacotar -- --allow-dirty   (inclui só o que já foi commitado; avisa das mudanças soltas)
// Por que git archive e não "zipar a pasta": a pasta de trabalho pode ter .env, .dev.vars, prisma/dev.db (contas de demonstração),
// .wrangler/, .open-next/, .next/ e node_modules/. O git archive leva só o que está no repositório e o script ainda confere o resultado.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const allowDirty = process.argv.includes("--allow-dirty");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

let root;
try {
  root = run("git", ["rev-parse", "--show-toplevel"]).trim();
} catch {
  fail("Isto precisa rodar dentro do repositório git do projeto (o zip é montado só com os arquivos versionados).");
}
process.chdir(root);

const untracked = run("git", ["ls-files", "--others", "--exclude-standard"]).trim();
if (untracked) {
  console.warn(`⚠ Arquivos NOVOS que ainda não foram adicionados ao git (ficam de fora do zip; se o site depende deles, o build do ChatGPT quebra):\n${untracked}\n`);
}
const dirty = run("git", ["status", "--porcelain", "--untracked-files=no"]).trim();
if (dirty && !allowDirty) {
  fail(`Há mudanças ainda não commitadas (elas NÃO iriam no zip):\n${dirty}\n\nFaça o commit, ou rode com --allow-dirty para empacotar só o que já foi commitado.`);
}
if (dirty) console.warn("⚠ Mudanças não commitadas ficam de fora do zip:\n" + dirty + "\n");

const hash = run("git", ["rev-parse", "--short=10", "HEAD"]).trim();
const day = new Date().toISOString().slice(0, 10);
const name = `prime-arena-${day}-${hash}`;
// Sem pasta dentro do zip (os arquivos ficam na raiz): é o que os guias de instalação em servidor esperam ("cd pasta && unzip arquivo.zip").
const outDir = join(root, "entrega");
const out = join(outDir, `${name}.zip`);
mkdirSync(outDir, { recursive: true });
// pacotes de antes vão para entrega/antigos/: só um prime-arena-*.zip fica à vista, para ninguém anexar ou enviar o errado
const old = readdirSync(outDir).filter((f) => /^prime-arena-.*\.zip$/.test(f) && f !== `${name}.zip`);
if (old.length) {
  mkdirSync(join(outDir, "antigos"), { recursive: true });
  for (const f of old) renameSync(join(outDir, f), join(outDir, "antigos", f));
}

const tmp = mkdtempSync(join(tmpdir(), "pa-empacotar-"));
try {
  const versao = join(tmp, "VERSAO.txt");
  writeFileSync(
    versao,
    `Prime Arena: pacote ${name}\nGerado em: ${new Date().toISOString()}\nCommit: ${run("git", ["rev-parse", "HEAD"]).trim()}\n\nSe você recebeu outro zip com data/commit diferente, use sempre o mais novo.\nComece por COMECE_AQUI.md.\n`,
  );
  run("git", ["archive", "--format=zip", "-9", `--add-file=${versao}`, "-o", out, "HEAD"]);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── Conferência do conteúdo ──
function failAndDelete(msg) {
  rmSync(out, { force: true });
  fail(msg);
}
let listing;
let how = "abrindo o zip";
try {
  listing = run("unzip", ["-Z1", out]).split("\n").filter(Boolean);
} catch {
  // sem `unzip` (ex.: Windows): o zip é exatamente o que o git guardou no HEAD + VERSAO.txt, então a lista vem do git
  try {
    listing = [...run("git", ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n").filter(Boolean), "VERSAO.txt"];
    how = "pela lista do git (o programa `unzip` não existe aqui)";
  } catch {
    failAndDelete("Não consegui conferir o conteúdo do zip. Ele foi APAGADO para ninguém usá-lo sem conferência.");
  }
}
const files = listing.filter((p) => !p.endsWith("/"));

const FORBIDDEN = [
  // qualquer .env* (em qualquer pasta) menos os modelos sem segredo
  [(p) => /(^|\/)\.env(\..+)?$/.test(p) && !/(^|\/)\.env\.(example|production\.example)$/.test(p), ".env com segredos"],
  [(p) => /(^|\/)\.dev\.vars(\..+)?$/.test(p) && !/(^|\/)\.dev\.vars\.example$/.test(p), ".dev.vars (segredos locais do Cloudflare)"],
  [(p) => /\.(db|db-journal|sqlite|sqlite3)$/.test(p), "arquivo de banco de dados"],
  [(p) => /(^|\/)\.wrangler\//.test(p), ".wrangler/ (banco local de teste)"],
  [(p) => /(^|\/)\.open-next\//.test(p), ".open-next/ (pacote montado)"],
  [(p) => /(^|\/)\.next\//.test(p), ".next/ (pacote montado)"],
  [(p) => /(^|\/)node_modules\//.test(p), "node_modules/"],
  [(p) => /(^|\/)\.claude\//.test(p), ".claude/"],
  [(p) => /(^|\/)(entrega|test-results|playwright-report|\.dev-mail)\//.test(p), "pasta de saída/teste"],
  [(p) => /\.(pem|key|p12|pfx)$/.test(p), "chave privada/certificado"],
];
const REQUIRED = [
  "COMECE_AQUI.md",
  "PROMPT_PARA_O_CHATGPT.md",
  "VERSAO.txt",
  "docs/SITES.md",
  "docs/SEGURANCA.md",
  "docs/CONFIGURAR_EMAIL.md",
  "docs/CONFIGURAR_PIX.md",
  "wrangler.jsonc",
  "worker.ts",
  "open-next.config.ts",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "prisma/schema.prisma",
  "migrations/0001_prime_arena.sql",
  "migrations/0002_d1_engine.sql",
  "src/lib/d1-engine.ts",
  "src/lib/db.d1.ts",
  "src/lib/model-meta.generated.ts",
  "src/generated/prisma-d1/client.ts",
  ".env.example",
  ".dev.vars.example",
];

const problems = [];
// marcadores de preenchimento (@@N_...@@) esquecidos nos guias
try {
  const left = run("git", ["grep", "-nE", "@@[A-Z0-9_]+@@", "HEAD", "--", ".", ":!scripts/empacotar.mjs"]).trim();
  if (left) for (const l of left.split("\n")) problems.push(`marcador de preenchimento esquecido: ${l.replace(/^HEAD:/, "")}`);
} catch {
  /* git grep sai com 1 quando não acha nada: é o esperado */
}
for (const f of files) for (const [test, why] of FORBIDDEN) if (test(f)) problems.push(`proibido no zip: ${f} (${why})`);
const have = new Set(files);
for (const f of REQUIRED) if (!have.has(f)) problems.push(`faltando no zip: ${f}`);
if (problems.length) {
  rmSync(out, { force: true });
  fail(`O zip foi APAGADO porque a conferência falhou:\n- ${problems.join("\n- ")}`);
}

const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`✔ ${out}\n  ${files.length} arquivos, ${mb} MB. Conferido ${how}: sem .env/.dev.vars/banco/.wrangler/.open-next/node_modules/.claude; com os ${REQUIRED.length} arquivos essenciais.\n  Anexe SOMENTE este arquivo na conversa do ChatGPT.`);
if (!existsSync(out)) process.exit(1);
