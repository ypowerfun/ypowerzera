#!/usr/bin/env node
// Gera src/lib/model-meta.generated.ts a partir do esquema do Prisma.
// O motor de transações do D1 (src/lib/d1-engine.ts) usa esses metadados para desfazer escritas:
// quais campos existem, qual é a chave primária, o que cascateia ao apagar e quais colunas são Json.
//
//   node scripts/gen-model-meta.mjs          grava o arquivo
//   node scripts/gen-model-meta.mjs --check  só confere (sai com 1 se estiver desatualizado)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Prisma } = require(path.join(root, "node_modules/@prisma/client"));
const out = path.join(root, "src/lib/model-meta.generated.ts");

const SUPPORTED = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json"]);
const models = Prisma.dmmf.datamodel.models;
const enums = new Set(Prisma.dmmf.datamodel.enums.map((e) => e.name));
const lower = (s) => s[0].toLowerCase() + s.slice(1);

const meta = {};
for (const m of models) {
  if (m.primaryKey) throw new Error(`${m.name}: chave primária composta não é suportada pelo motor D1`);
  const idFields = m.fields.filter((f) => f.isId);
  if (idFields.length !== 1) throw new Error(`${m.name}: esperava exatamente uma chave primária`);
  const id = idFields[0];
  const scalars = [];
  const jsonFields = [];
  const dateFields = [];
  for (const f of m.fields) {
    if (f.kind === "object") continue;
    if (f.kind === "scalar" && !SUPPORTED.has(f.type)) throw new Error(`${m.name}.${f.name}: tipo ${f.type} não é suportado pelo motor D1 (BigInt/Decimal/Bytes precisam de tratamento próprio)`);
    if (f.kind === "enum" && !enums.has(f.type)) throw new Error(`${m.name}.${f.name}: enum desconhecido`);
    if (f.isList) throw new Error(`${m.name}.${f.name}: lista escalar não é suportada pelo motor D1`);
    scalars.push(f.name);
    if (f.type === "Json") jsonFields.push({ name: f.name, optional: !f.isRequired });
    if (f.type === "DateTime") dateFields.push(f.name);
  }
  meta[m.name] = {
    delegate: lower(m.name),
    pk: id.name,
    // chave gerada pelo cliente (cuid): o motor sorteia o valor antes de gravar, para registrar o "desfazer" ANTES da escrita
    pkGenerated: id.default?.name === "cuid" || id.default?.name === "uuid",
    scalars,
    jsonFields,
    dateFields,
    relations: [],
    dependents: [],
  };
}
// campos de relação (para detectar escritas aninhadas) e dependentes (o que cascateia ao apagar)
for (const m of models) {
  for (const f of m.fields) {
    if (f.kind !== "object") continue;
    meta[m.name].relations.push(f.name);
    if (f.relationFromFields?.length) {
      if (f.relationFromFields.length > 1) throw new Error(`${m.name}.${f.name}: chave estrangeira composta não é suportada`);
      const onDelete = f.relationOnDelete ?? (f.isRequired ? "Restrict" : "SetNull");
      meta[f.type].dependents.push({ model: m.name, fk: f.relationFromFields[0], ref: f.relationToFields[0], onDelete });
    }
  }
}

const body = `// ARQUIVO GERADO por scripts/gen-model-meta.mjs a partir de prisma/schema.prisma. Não edite à mão.
// Regerar: npm run generate:meta
/* eslint-disable */

export interface ModelMeta {
  delegate: string;
  pk: string;
  pkGenerated: boolean;
  scalars: string[];
  jsonFields: Array<{ name: string; optional: boolean }>;
  dateFields: string[];
  relations: string[];
  dependents: Array<{ model: string; fk: string; ref: string; onDelete: "Cascade" | "SetNull" | "Restrict" | "NoAction" | "SetDefault" }>;
}

export const MODEL_META: Record<string, ModelMeta> = ${JSON.stringify(meta, null, 2)};
`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {}
  if (current !== body) {
    console.error("src/lib/model-meta.generated.ts está desatualizado em relação ao prisma/schema.prisma. Rode: npm run generate:meta");
    process.exit(1);
  }
  console.log("model-meta.generated.ts em dia.");
} else {
  writeFileSync(out, body);
  console.log(`Gerado: ${path.relative(root, out)} (${Object.keys(meta).length} modelos)`);
}
