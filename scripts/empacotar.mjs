// Monta o .zip para entregar (ChatGPT Sites ou servidor): SÓ os arquivos versionados no git (HEAD).
//   npm run empacotar            → entrega/prime-arena-AAAA-MM-DD-<commit>.zip
//   npm run empacotar -- --allow-dirty   (inclui só o que já foi commitado; avisa das mudanças soltas)
// Por que git archive e não "zipar a pasta": a pasta de trabalho pode ter .env, .dev.vars, prisma/dev.db (contas de demonstração),
// .wrangler/, .open-next/, .next/ e node_modules/. O git archive leva só o que está no repositório e o script ainda confere o resultado.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
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
let listing;
try {
  listing = run("unzip", ["-Z1", out]).split("\n").filter(Boolean);
} catch {
  fail("Não consegui listar o zip (falta o programa `unzip`). Instale-o e rode de novo; o zip NÃO foi conferido.");
}
const files = listing.filter((p) => !p.endsWith("/"));

const FORBIDDEN = [
  [(p) => p === ".env" || /^\.env\.(local|production|development|test)$/.test(p) || /\.env\.[^/]*\.local$/.test(p), ".env com segredos"],
  [(p) => p === ".dev.vars" || p.endsWith("/.dev.vars"), ".dev.vars (segredos locais do Cloudflare)"],
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
for (const f of files) for (const [test, why] of FORBIDDEN) if (test(f)) problems.push(`proibido no zip: ${f} (${why})`);
const have = new Set(files);
for (const f of REQUIRED) if (!have.has(f)) problems.push(`faltando no zip: ${f}`);
if (problems.length) {
  rmSync(out, { force: true });
  fail(`O zip foi APAGADO porque a conferência falhou:\n- ${problems.join("\n- ")}`);
}

const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`✔ ${out}\n  ${files.length} arquivos, ${mb} MB. Conferido: sem .env/.dev.vars/banco/.wrangler/.open-next/node_modules/.claude; com os ${REQUIRED.length} arquivos essenciais.\n  Anexe SOMENTE este arquivo na conversa do ChatGPT.`);
if (!existsSync(out)) process.exit(1);
