#!/usr/bin/env node
// Leva os dados de um banco SQLite do Prime Arena (o do servidor próprio/Docker, ou o de desenvolvimento) para o D1 do
// ChatGPT Sites. Gera um arquivo .sql com um INSERT por linha, na ordem certa (pais antes dos filhos) e com as datas
// convertidas para o formato do D1 (texto ISO). Misturar milissegundos inteiros com texto na mesma coluna quebraria todas
// as comparações de data (vencimentos, prazos), por isso a conversão é obrigatória.
//
//   node scripts/export-to-d1.mjs --db caminho/do/banco.db --out dados-d1.sql
//   npx wrangler d1 execute primearena --remote --file dados-d1.sql      (com o D1 já criado e as migrações aplicadas)
//
// Nada é alterado no banco de origem (só leitura). O arquivo gerado contém dados pessoais (e-mails, CPF CIFRADO): guarde-o
// com o mesmo cuidado do .env e apague depois da importação.
import { DatabaseSync } from "node:sqlite";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dbPath = opt("--db");
const outPath = opt("--out") ?? "dados-d1.sql";
const allowDemo = args.includes("--allow-demo");
if (!dbPath || !existsSync(dbPath)) {
  console.error("Uso: node scripts/export-to-d1.mjs --db caminho/do/banco.db [--out dados-d1.sql] [--allow-demo]");
  process.exit(1);
}

const db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });
// Tabelas que não vão para o D1: controle de migrações do Prisma, cobranças/transferências SIMULADAS e as do motor do D1.
const SKIP = (name) => name.startsWith("sqlite_") || name.startsWith("_") || name === "MockPixCharge" || name === "MockPixTransfer";
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  .all()
  .map((r) => r.name)
  .filter((n) => !SKIP(n));

if (!allowDemo && tables.includes("User")) {
  const demo = db.prepare("SELECT COUNT(*) AS c FROM User WHERE email LIKE '%@primearena.local'").get().c;
  if (demo > 0) {
    console.error(`O banco tem ${demo} conta(s) de demonstração (@primearena.local) com senha pública. Não importe isso num site de verdade. (Use --allow-demo só para testar.)`);
    process.exit(1);
  }
}

// ordem: cada tabela depois das tabelas que ela referencia
const deps = new Map(tables.map((t) => [t, new Set(db.prepare(`PRAGMA foreign_key_list("${t}")`).all().map((f) => f.table).filter((p) => p !== t && tables.includes(p)))]));
const order = [];
const seen = new Set();
const visit = (t, stack = new Set()) => {
  if (seen.has(t) || stack.has(t)) return; // ciclo: o PRAGMA defer_foreign_keys cobre
  stack.add(t);
  for (const p of deps.get(t) ?? []) visit(p, stack);
  seen.add(t);
  order.push(t);
};
tables.forEach((t) => visit(t));

const iso = (ms) => new Date(ms).toISOString().replace("Z", "+00:00");
const lit = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) throw new Error("coluna binária não é suportada");
  return `'${String(v).replace(/'/g, "''")}'`;
};

const lines = ["-- Gerado por scripts/export-to-d1.mjs. Contém dados pessoais: apague depois de importar.", "PRAGMA defer_foreign_keys = true;"];
const counts = {};
for (const t of order) {
  const cols = db.prepare(`PRAGMA table_info("${t}")`).all();
  const dateCols = new Set(cols.filter((c) => /DATE/i.test(c.type)).map((c) => c.name));
  const rows = db.prepare(`SELECT * FROM "${t}"`).all();
  counts[t] = rows.length;
  for (const row of rows) {
    const values = cols.map((c) => {
      let v = row[c.name];
      if (dateCols.has(c.name) && typeof v === "number") v = iso(v); // milissegundos → texto ISO
      else if (dateCols.has(c.name) && typeof v === "string" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?$/.test(v)) v = new Date(v.replace(" ", "T") + "Z").toISOString().replace("Z", "+00:00");
      return lit(v);
    });
    lines.push(`INSERT INTO "${t}" (${cols.map((c) => `"${c.name}"`).join(", ")}) VALUES (${values.join(", ")});`);
  }
}
writeFileSync(outPath, lines.join("\n") + "\n");
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.error(`Gerado ${outPath}: ${total} linhas em ${order.length} tabelas.`);
for (const t of order) if (counts[t]) console.error(`  ${t}: ${counts[t]}`);
