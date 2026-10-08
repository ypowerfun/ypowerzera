/**
 * Motor de transações para o Cloudflare D1 (ChatGPT Sites).
 *
 * POR QUE EXISTE
 * O D1 não tem BEGIN/COMMIT: cada comando é gravado na hora e o Prisma recusa `$transaction` interativa (e a forma em
 * lista NÃO é atômica). Mas todo o dinheiro do site (carteira, saques, desafios, pedidos) foi escrito em cima de
 * transações. Em vez de reescrever essa lógica, este módulo devolve a mesma garantia ("tudo ou nada") assim:
 *
 *  1. TRAVA GLOBAL DE ESCRITA (tabela _Lease, uma linha). Só um dono por vez escreve: toda transação, e toda escrita
 *     avulsa, toma a trava (compare-e-troca atômico em um único UPDATE). É o mesmo modelo do SQLite com 1 escritor
 *     para o qual o projeto foi desenhado. Quem não consegue espera (com limite) e depois falha com erro amigável.
 *  2. DIÁRIO DE DESFAZER (tabela _Journal). Antes de CADA escrita dentro da transação, o "como desfazer" (a linha como
 *     era, ou o id do que vai ser criado) é gravado no próprio banco.
 *  3. COMMIT = apagar o diário da transação e soltar a trava, em um único batch atômico do D1.
 *     ROLLBACK = reaplicar o diário de trás para frente (cada passo é idempotente) e então soltar.
 *  4. RECUPERAÇÃO DE QUEDA. Se o servidor morrer no meio (o Worker é encerrado, a energia cai), a trava expira
 *     (TTL) e o PRÓXIMO que a tomar encontra o diário e desfaz a transação inacabada ANTES de qualquer coisa.
 *
 * O QUE NÃO GARANTE (leia): leituras feitas fora da trava podem enxergar, por instantes, escritas de uma transação que
 * ainda vai terminar (e que pode ser desfeita). Toda decisão de dinheiro é tomada DENTRO da transação (já protegida).
 * Isto não é um substituto de um banco com transações de verdade; é a melhor garantia possível sobre o D1.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "./errors";
import { MODEL_META, type ModelMeta } from "./model-meta.generated";

// ───────────────────────── tipos mínimos do D1 (compatíveis com o binding real e com o Miniflare) ─────────────────────────

export interface D1PreparedLike {
  bind(...values: unknown[]): D1PreparedLike;
}
export interface D1ResultLike {
  results?: unknown[];
  meta?: { changes?: number };
}
export interface D1Like {
  prepare(sql: string): D1PreparedLike;
  batch(statements: D1PreparedLike[]): Promise<D1ResultLike[]>;
}

// ───────────────────────── parâmetros ─────────────────────────

/** A trava vence sozinha depois disto, se o dono morrer. Tem que ser MUITO maior que o prazo de uma transação. */
export const LEASE_TTL_MS = 40_000;
/** Prazo máximo de uma transação (depois dele, novas escritas são recusadas e a transação é desfeita). */
export const TX_DEADLINE_MS = 25_000;
/** Quanto tempo esperar pela trava antes de desistir com erro amigável. */
export const ACQUIRE_MAX_WAIT_MS = 20_000;
/** Teto de linhas que uma única operação dentro de transação pode tocar (para o diário não explodir). */
export const MAX_ROWS_PER_OP = 5_000;
const JOURNAL_CHUNK_ROWS = 40;
/** Cada linha do diário fica bem abaixo do limite de ~2 MB por linha do D1. */
const JOURNAL_CHUNK_BYTES = 400_000;
/** Comandos por lote enviado ao D1 (o limite documentado é maior; esta folga evita surpresas). */
const D1_BATCH_MAX = 50;
/** Depois de tantas tentativas seguidas de desfazer sem sucesso, o diário vai para quarentena (veja `acquire`). */
const MAX_RECOVERY_FAILURES = 5;

/** Modelos que NUNCA são escritos dentro de transação: escritas avulsas neles dispensam a trava (é um UPDATE atômico). */
export const LEASE_EXEMPT_MODELS: ReadonlySet<string> = new Set(["RateLimit"]);

const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert", "delete", "deleteMany"]);

// ───────────────────────── erros ─────────────────────────

export class DbBusyError extends AppError {
  constructor() {
    super("O sistema está ocupado no momento. Tente novamente em instantes.");
  }
}

/** Só para testes: simula o processo morrendo. O motor NÃO faz limpeza ao vê-lo (como se a energia tivesse caído). */
export class SimulatedCrash extends Error {
  constructor(public readonly point: string) {
    super(`queda simulada em ${point}`);
  }
}

// ───────────────────────── utilidades ─────────────────────────

let idCounter = 0;
/** Id parecido com cuid (ordenável por tempo). Só é usado para registrar o "desfazer" ANTES de criar a linha. */
export function newId(now: number = Date.now()): string {
  idCounter = (idCounter + 1) % 1_679_616; // 36^4
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let rnd = "";
  for (const b of bytes) rnd += (b % 36).toString(36);
  return `c${now.toString(36).padStart(9, "0")}${idCounter.toString(36).padStart(4, "0")}${rnd}`;
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
type Row = Record<string, unknown>;

interface Undo {
  /** del = apagar o que foi criado; rest = restaurar a linha como era; ins = recriar o que foi apagado */
  k: "del" | "rest" | "ins";
  m: string;
  w?: Row;
  d?: Row;
}

interface TxCtx {
  id: string;
  deadline: number;
  seq: number;
  tail: Promise<unknown>;
  closed: boolean;
  /** true quando a transação foi DESFEITA: qualquer escrita que chegue depois (ramo órfão de Promise.all) é recusada. */
  rolledBack: boolean;
  rows: number;
}

export interface EngineDeps {
  d1: D1Like;
  /** Cliente Prisma "puro" (com o adaptador do D1), sem extensões. */
  base: Record<string, unknown> & { $extends: (ext: unknown) => unknown };
  /** `Prisma.DbNull` / `Prisma.JsonNull` do cliente em uso (para restaurar colunas Json). */
  dbNull: unknown;
  jsonNull: unknown;
  meta?: Record<string, ModelMeta>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Só para testes: chamado em pontos críticos; pode lançar SimulatedCrash. */
  crashPoint?: (label: string) => void;
  leaseTtlMs?: number;
  txDeadlineMs?: number;
  acquireMaxWaitMs?: number;
}

type Delegate = Record<string, (args?: unknown) => Promise<unknown>>;

export function createD1Engine(deps: EngineDeps) {
  const M = deps.meta ?? MODEL_META;
  const d1 = deps.d1;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? sleepReal;
  const crash = deps.crashPoint ?? (() => undefined);
  const leaseTtl = deps.leaseTtlMs ?? LEASE_TTL_MS;
  const txDeadline = deps.txDeadlineMs ?? TX_DEADLINE_MS;
  const acquireMax = deps.acquireMaxWaitMs ?? ACQUIRE_MAX_WAIT_MS;
  const als = new AsyncLocalStorage<TxCtx>();
  const baseDelegate = (model: string): Delegate => {
    const meta = M[model];
    if (!meta) throw new Error(`d1-engine: modelo desconhecido ${model}`);
    return deps.base[meta.delegate] as Delegate;
  };

  // ───────── trava + recuperação ─────────

  /** Toma a trava (esperando, se preciso). Se encontrar o diário de uma transação que morreu, desfaz antes de seguir. */
  async function acquire(owner: string): Promise<number> {
    const started = now();
    for (;;) {
      const t = now();
      const [upd, journal] = await d1.batch([
        d1.prepare("UPDATE _Lease SET owner = ?1, expiresAt = ?2 WHERE id = 1 AND (owner IS NULL OR expiresAt < ?3)").bind(owner, t + leaseTtl, t),
        // só quem CONSEGUIU a trava recebe o diário (quem perde a disputa não baixa nada a cada tentativa)
        d1.prepare("SELECT undo FROM _Journal WHERE EXISTS (SELECT 1 FROM _Lease WHERE id = 1 AND owner = ?1) ORDER BY rowid DESC").bind(owner),
      ]);
      if ((upd?.meta?.changes ?? 0) === 1) {
        const pending = (journal?.results ?? []) as Array<{ undo: string }>;
        if (pending.length) {
          try {
            await applyUndoRows(pending.map((r) => r.undo), owner);
            await d1.batch([d1.prepare("DELETE FROM _Journal"), d1.prepare("UPDATE _Lease SET failures = 0 WHERE id = 1")]);
          } catch (e) {
            // Falhou desfazer uma transação que morreu. Tentamos de novo nos próximos pedidos; se continuar falhando, o diário vai
            // para quarentena (_JournalDead) para o site NÃO ficar travado para sempre, e o erro fica no log. A conciliação do
            // dinheiro (Admin) acusa qualquer divergência que sobrar.
            const bump = await d1.batch([d1.prepare("UPDATE _Lease SET failures = failures + 1 WHERE id = 1 AND owner = ?1 RETURNING failures").bind(owner)]);
            const failures = ((bump[0]?.results?.[0] as { failures?: number } | undefined)?.failures ?? 1) as number;
            if (failures >= MAX_RECOVERY_FAILURES) {
              console.error("[d1-engine] RECUPERAÇÃO FALHOU %d vezes; diário movido para _JournalDead. Confira a conciliação em Admin.", failures, e);
              await d1.batch([
                d1.prepare("INSERT INTO _JournalDead (txId, seq, undo, deadAt) SELECT txId, seq, undo, ?1 FROM _Journal").bind(t),
                d1.prepare("DELETE FROM _Journal"),
                d1.prepare("UPDATE _Lease SET failures = 0 WHERE id = 1"),
              ]);
              return t;
            }
            await releaseLease(owner).catch(() => undefined);
            throw e;
          }
        }
        return t;
      }
      if (now() - started > acquireMax) throw new DbBusyError();
      await sleep(15 + Math.floor(Math.random() * 60));
    }
  }

  /** Solta a trava (e, se for o fim de uma transação, apaga o diário dela NO MESMO batch atômico: esse é o commit). */
  async function releaseLease(owner: string, txId?: string): Promise<void> {
    const stmts = [];
    if (txId) stmts.push(d1.prepare("DELETE FROM _Journal WHERE txId = ?1").bind(txId));
    stmts.push(d1.prepare("UPDATE _Lease SET owner = NULL, expiresAt = 0 WHERE id = 1 AND owner = ?1").bind(owner));
    await d1.batch(stmts);
  }

  /** COMMIT: só vale se a trava ainda é desta transação (senão outro Worker já a desfez) — e nesse caso FALHA em vez de fingir sucesso. */
  async function commit(owner: string): Promise<void> {
    const res = await d1.batch([
      d1.prepare("DELETE FROM _Journal WHERE txId = ?1 AND EXISTS (SELECT 1 FROM _Lease WHERE id = 1 AND owner = ?1)").bind(owner),
      d1.prepare("UPDATE _Lease SET owner = NULL, expiresAt = 0 WHERE id = 1 AND owner = ?1").bind(owner),
    ]);
    if ((res[1]?.meta?.changes ?? 0) !== 1) throw new AppError("A operação demorou demais e foi cancelada. Tente novamente.");
  }

  async function withLease<T>(fn: () => Promise<T>): Promise<T> {
    const owner = newId(now());
    await acquire(owner);
    let ok = false;
    try {
      const r = await fn();
      ok = true;
      return r;
    } finally {
      if (ok) await releaseLease(owner);
      else await releaseLease(owner).catch(() => undefined);
    }
  }

  // ───────── (de)serialização do diário ─────────

  function decodeRow(model: string, row: Row): Row {
    const meta = M[model];
    const out: Row = { ...row };
    for (const f of meta.dateFields) if (typeof out[f] === "string") out[f] = new Date(out[f] as string);
    for (const j of meta.jsonFields) if (out[j.name] === null) out[j.name] = j.optional ? deps.dbNull : deps.jsonNull;
    return out;
  }

  /**
   * Renova a trava do dono (mais `leaseTtl` a partir de agora) e confirma que ela ainda é dele. Se não for mais, lança: quem perdeu a
   * trava não pode seguir escrevendo nem desfazendo (sobrescreveria o que o novo dono já confirmou).
   */
  async function renewLease(owner: string): Promise<void> {
    const t = now();
    const res = await d1.batch([d1.prepare("UPDATE _Lease SET expiresAt = ?2 WHERE id = 1 AND owner = ?1").bind(owner, t + leaseTtl)]);
    if ((res[0]?.meta?.changes ?? 0) !== 1) throw new AppError("A operação foi interrompida porque demorou demais. Tente novamente.");
  }

  async function applyUndoRows(serialized: string[], owner?: string): Promise<void> {
    // `serialized` já vem do mais novo para o mais antigo; dentro de cada linha, de trás para frente
    for (const text of serialized) {
      const entries = JSON.parse(text) as Undo[];
      for (let i = entries.length - 1; i >= 0; i--) {
        if (owner) await renewLease(owner); // desfazer lento não pode deixar a trava vencer no meio e pisar na escrita do próximo dono
        await applyUndo(entries[i]);
      }
    }
  }

  async function applyUndo(u: Undo): Promise<void> {
    const dlg = baseDelegate(u.m);
    const pk = M[u.m].pk;
    if (u.k === "del") {
      await dlg.deleteMany({ where: u.w });
    } else if (u.k === "rest") {
      const data = decodeRow(u.m, u.d as Row);
      delete data[pk];
      await dlg.updateMany({ where: u.w, data });
    } else {
      const row = decodeRow(u.m, u.d as Row);
      // idempotente: se a linha já voltou (recuperação repetida), não recria
      const exists = await dlg.findUnique({ where: { [pk]: row[pk] }, select: { [pk]: true } });
      if (!exists) await dlg.create({ data: row });
    }
  }

  /** Desfaz (e apaga do diário) as entradas com seq >= fromSeq desta transação: usado por escritas que falharam e por $transaction aninhada. */
  async function undoSince(ctx: TxCtx, fromSeq: number): Promise<void> {
    const rows = (await d1.batch([d1.prepare("SELECT undo FROM _Journal WHERE txId = ?1 AND seq >= ?2 ORDER BY seq DESC").bind(ctx.id, fromSeq)]))[0]?.results as Array<{ undo: string }> | undefined;
    if (!rows?.length) return;
    await applyUndoRows(rows.map((r) => r.undo), ctx.id);
    await d1.batch([d1.prepare("DELETE FROM _Journal WHERE txId = ?1 AND seq >= ?2").bind(ctx.id, fromSeq)]);
  }

  async function journalAppend(ctx: TxCtx, entries: Undo[]): Promise<void> {
    if (!entries.length) return;
    // fatias por TAMANHO (o D1 limita cada linha a ~2 MB) e por quantidade
    const slices: Undo[][] = [];
    let cur: Undo[] = [];
    let bytes = 0;
    for (const e of entries) {
      const size = JSON.stringify(e).length;
      if (cur.length && (cur.length >= JOURNAL_CHUNK_ROWS || bytes + size > JOURNAL_CHUNK_BYTES)) {
        slices.push(cur);
        cur = [];
        bytes = 0;
      }
      cur.push(e);
      bytes += size;
    }
    if (cur.length) slices.push(cur);
    for (let i = 0; i < slices.length; i += D1_BATCH_MAX) {
      const group = slices.slice(i, i + D1_BATCH_MAX);
      // só grava se a trava ainda é desta transação: quem perdeu a trava (ficou parado além do prazo) é barrado ANTES de escrever;
      // e cada gravação renova a trava (uma chamada lenta precisa durar um TTL inteiro para perdê-la)
      const stmts: D1PreparedLike[] = group.map((slice) =>
        d1
          .prepare("INSERT INTO _Journal (txId, seq, undo) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM _Lease WHERE id = 1 AND owner = ?1)")
          .bind(ctx.id, ctx.seq++, JSON.stringify(slice)),
      );
      stmts.push(d1.prepare("UPDATE _Lease SET expiresAt = ?2 WHERE id = 1 AND owner = ?1").bind(ctx.id, now() + leaseTtl));
      const res = await d1.batch(stmts);
      if (res.some((r) => (r?.meta?.changes ?? 0) !== 1)) throw new AppError("A operação foi interrompida porque demorou demais. Tente novamente.");
    }
    crash("after-journal");
  }

  // ───────── preparar cada tipo de escrita (calcula o "desfazer") ─────────

  function rejectNested(model: string, data: unknown, what: string): void {
    if (!data || typeof data !== "object") return;
    const rels = new Set(M[model].relations);
    for (const k of Object.keys(data as Row)) {
      if (rels.has(k)) throw new Error(`d1-engine: escrita aninhada (${model}.${k}) não é suportada em ${what}; faça as gravações em passos separados.`);
    }
  }

  function rejectPkChange(model: string, data: unknown, what: string): void {
    if (data && typeof data === "object" && (data as Row)[M[model].pk] !== undefined) {
      throw new Error(`d1-engine: alterar a chave primária (${model}.${M[model].pk}) não é suportado em ${what}: o desfazer não alcança a linha renomeada nem as cascatas ON UPDATE.`);
    }
  }

  const pkWhere = (model: string, row: Row): Row => ({ [M[model].pk]: row[M[model].pk] });

  function guardRows(ctx: TxCtx, n: number, model: string): void {
    ctx.rows += n;
    if (n > MAX_ROWS_PER_OP || ctx.rows > MAX_ROWS_PER_OP * 4) {
      throw new Error(`d1-engine: operação em ${model} toca linhas demais (${n}) para uma transação no D1.`);
    }
  }

  /** Para criação: devolve os dados com a chave sorteada e o "desfazer" (só quando a linha ainda não existe). */
  async function prepareCreateRow(model: string, data: Row): Promise<{ data: Row; undo: Undo | null }> {
    const meta = M[model];
    const row: Row = { ...data };
    rejectNested(model, row, "create");
    let key = row[meta.pk];
    if (key === undefined || key === null) {
      if (!meta.pkGenerated) throw new Error(`d1-engine: ${model} exige a chave ${meta.pk}`);
      key = newId(now());
      row[meta.pk] = key;
      return { data: row, undo: { k: "del", m: model, w: { [meta.pk]: key } } };
    }
    // chave informada por quem chamou (ex.: Wallet "platform"): se já existe, a criação vai falhar e NÃO podemos registrar
    // um "apagar" (apagaria a linha que já existia). Como temos a trava, a checagem é confiável.
    const existing = await baseDelegate(model).findUnique({ where: { [meta.pk]: key }, select: { [meta.pk]: true } });
    return { data: row, undo: existing ? null : { k: "del", m: model, w: { [meta.pk]: key } } };
  }

  async function prepareCreateMany(model: string, args: Row): Promise<{ args: Row; undo: Undo[] }> {
    const meta = M[model];
    const input = Array.isArray(args.data) ? (args.data as Row[]) : [args.data as Row];
    const rows: Row[] = [];
    const undo: Undo[] = [];
    const named: Row[] = [];
    for (const r of input) {
      const row: Row = { ...r };
      rejectNested(model, row, "createMany");
      if (row[meta.pk] === undefined || row[meta.pk] === null) {
        if (!meta.pkGenerated) throw new Error(`d1-engine: ${model} exige a chave ${meta.pk}`);
        row[meta.pk] = newId(now());
        undo.push({ k: "del", m: model, w: { [meta.pk]: row[meta.pk] } });
      } else {
        named.push(row);
      }
      rows.push(row);
    }
    if (named.length) {
      const keys = named.map((r) => r[meta.pk]);
      const existing = (await baseDelegate(model).findMany({ where: { [meta.pk]: { in: keys } }, select: { [meta.pk]: true } })) as Row[];
      const have = new Set(existing.map((e) => e[meta.pk]));
      for (const r of named) if (!have.has(r[meta.pk])) undo.push({ k: "del", m: model, w: { [meta.pk]: r[meta.pk] } });
    }
    return { args: { ...args, data: Array.isArray(args.data) ? rows : rows[0] }, undo };
  }

  /** Imagem "antes" das linhas que um update/updateMany vai alterar. */
  async function restoreEntries(model: string, rows: Row[]): Promise<Undo[]> {
    return rows.map((r) => ({ k: "rest" as const, m: model, w: pkWhere(model, r), d: r }));
  }

  /** Para apagar: guarda as linhas, os filhos em cascata e os que viram NULL, na ordem certa para restaurar. */
  // posição do modelo na cadeia de chaves estrangeiras (pais antes dos filhos): define a ordem de recriação ao desfazer
  const rankMemo = new Map<string, number>();
  function rank(model: string, guard = 0): number {
    const hit = rankMemo.get(model);
    if (hit !== undefined) return hit;
    let r = 0;
    if (guard < 50) for (const [pm, pmeta] of Object.entries(M)) if (pmeta.dependents.some((d) => d.model === model && pm !== model)) r = Math.max(r, 1 + rank(pm, guard + 1));
    rankMemo.set(model, r);
    return r;
  }

  /**
   * Cascata em losango (ex.: BrResult depende de BrGame E de Participant): a ordem em que a recursão encontra as linhas
   * NÃO serve para recriá-las. Aqui: sem repetições, todos os `ins` do pai para o filho, e só DEPOIS os `rest` (reatar SetNull).
   * (`out` é aplicado de trás para frente ao desfazer, então os pais ficam por último e os `rest` por primeiro.)
   */
  async function captureDelete(ctx: TxCtx, model: string, rows: Row[]): Promise<Undo[]> {
    const raw = await captureDeleteRaw(ctx, model, rows);
    const seen = new Set<string>();
    const ins: Undo[] = [];
    const rest: Undo[] = [];
    for (const u of raw) {
      if (u.k !== "ins") {
        rest.push(u);
        continue;
      }
      const key = `${u.m}\u0000${String((u.d as Row)[M[u.m].pk])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ins.push(u);
    }
    ins.sort((a, b) => rank(b.m) - rank(a.m)); // estável: filhos primeiro no array = pais primeiro ao desfazer
    return [...rest, ...ins];
  }

  async function captureDeleteRaw(ctx: TxCtx, model: string, rows: Row[]): Promise<Undo[]> {
    const out: Undo[] = [];
    if (!rows.length) return out;
    guardRows(ctx, rows.length, model);
    for (const dep of M[model].dependents) {
      if (dep.onDelete !== "Cascade" && dep.onDelete !== "SetNull") continue;
      const refs = [...new Set(rows.map((r) => r[dep.ref]))];
      const children = (await baseDelegate(dep.model).findMany({ where: { [dep.fk]: { in: refs } } })) as Row[];
      if (!children.length) continue;
      if (dep.onDelete === "Cascade") out.push(...(await captureDeleteRaw(ctx, dep.model, children)));
      else {
        guardRows(ctx, children.length, dep.model);
        out.push(...(await restoreEntries(dep.model, children)));
      }
    }
    for (const r of rows) out.push({ k: "ins", m: model, d: r });
    return out;
  }

  async function prepareWrite(ctx: TxCtx, model: string, op: string, args: Row): Promise<{ args: Row; undo: Undo[] }> {
    const dlg = baseDelegate(model);
    switch (op) {
      case "create": {
        const c = await prepareCreateRow(model, args.data as Row);
        return { args: { ...args, data: c.data }, undo: c.undo ? [c.undo] : [] };
      }
      case "createMany":
      case "createManyAndReturn":
        guardRows(ctx, Array.isArray(args.data) ? (args.data as unknown[]).length : 1, model);
        return prepareCreateMany(model, args);
      case "update": {
        rejectNested(model, args.data, "update");
        rejectPkChange(model, args.data, "update");
        const row = (await dlg.findUnique({ where: args.where })) as Row | null;
        return { args, undo: row ? await restoreEntries(model, [row]) : [] };
      }
      case "updateMany":
      case "updateManyAndReturn": {
        rejectNested(model, args.data, op);
        rejectPkChange(model, args.data, op);
        const rows = (await dlg.findMany({ where: args.where })) as Row[];
        guardRows(ctx, rows.length, model);
        return { args, undo: await restoreEntries(model, rows) };
      }
      case "upsert": {
        rejectNested(model, args.update, "upsert.update");
        rejectPkChange(model, args.update, "upsert.update");
        const row = (await dlg.findUnique({ where: args.where })) as Row | null;
        if (row) return { args, undo: await restoreEntries(model, [row]) };
        const c = await prepareCreateRow(model, args.create as Row);
        return { args: { ...args, create: c.data }, undo: c.undo ? [c.undo] : [] };
      }
      case "delete": {
        const row = (await dlg.findUnique({ where: args.where })) as Row | null;
        return { args, undo: row ? await captureDelete(ctx, model, [row]) : [] };
      }
      case "deleteMany": {
        const rows = (await dlg.findMany({ where: args.where })) as Row[];
        return { args, undo: await captureDelete(ctx, model, rows) };
      }
      default:
        throw new Error(`d1-engine: operação ${op} não suportada dentro de transação`);
    }
  }

  // ───────── interceptação de cada operação do Prisma ─────────

  function handle(model: string, operation: string, args: Row, query: (a: unknown) => Promise<unknown>): Promise<unknown> {
    if (!WRITE_OPS.has(operation)) return query(args);
    const ctx = als.getStore();
    if (ctx && !ctx.closed) return txWrite(ctx, model, operation, args, query);
    // ramo órfão de uma transação que já foi DESFEITA (ex.: Promise.all em que um ramo falhou): recusar, nunca virar escrita avulsa
    if (ctx && ctx.rolledBack) return Promise.reject(new Error("d1-engine: a transação já foi desfeita; esta escrita foi recusada."));
    // fora de transação também: uma escrita aninhada (pai + filhos) viraria vários comandos soltos e poderia ficar pela metade
    try {
      if (operation === "create" || operation === "update" || operation === "updateMany" || operation === "updateManyAndReturn") rejectNested(model, args.data, operation);
      if (operation === "createMany" || operation === "createManyAndReturn") for (const r of Array.isArray(args.data) ? (args.data as unknown[]) : [args.data]) rejectNested(model, r, operation);
      if (operation === "upsert") {
        rejectNested(model, args.create, "upsert.create");
        rejectNested(model, args.update, "upsert.update");
      }
    } catch (e) {
      return Promise.reject(e);
    }
    if (LEASE_EXEMPT_MODELS.has(model)) return query(args);
    return withLease(() => query(args));
  }

  function txWrite(ctx: TxCtx, model: string, op: string, args: Row, query: (a: unknown) => Promise<unknown>): Promise<unknown> {
    // escritas da mesma transação andam uma de cada vez (o diário precisa da ordem)
    const run = async () => {
      if (ctx.closed) throw new Error("d1-engine: a transação já terminou.");
      if (now() > ctx.deadline) throw new AppError("A operação demorou demais e foi cancelada. Tente novamente.");
      const prepared = await prepareWrite(ctx, model, op, args);
      const seqStart = ctx.seq;
      await journalAppend(ctx, prepared.undo);
      let result: unknown;
      try {
        result = await query(prepared.args);
      } catch (e) {
        // "tudo ou nada" por COMANDO (como no SQLite): o que esta operação gravou antes de falhar (ex.: createMany em várias partes) é desfeito já
        if (!(e instanceof SimulatedCrash) && ctx.seq > seqStart) await undoSince(ctx, seqStart).catch((u) => console.error("[d1-engine] desfazer da operação falhou; o rollback final tenta de novo:", u));
        throw e;
      }
      crash("after-write");
      return result;
    };
    const p = ctx.tail.then(run, run);
    ctx.tail = p.catch(() => undefined);
    return p;
  }

  // ───────── $transaction ─────────

  type TxFn<T> = (tx: unknown) => Promise<T>;
  let clientRef: unknown;

  async function transaction<T>(arg: TxFn<T> | Array<PromiseLike<unknown>>, options?: { timeout?: number }): Promise<T | unknown[]> {
    const body: TxFn<T> =
      typeof arg === "function"
        ? arg
        : (async () => {
            const out: unknown[] = [];
            for (const p of arg) out.push(await p); // PrismaPromise é preguiçoso: roda aqui, dentro do contexto da transação
            return out as unknown as T;
          });
    const outer = als.getStore();
    if (outer && !outer.closed) {
      // transação dentro de transação: junta-se à de fora, com "savepoint" — se a interna falhar, as escritas dela são desfeitas antes de o erro subir
      const mark = outer.seq;
      try {
        return await body(clientRef);
      } catch (e) {
        if (!(e instanceof SimulatedCrash)) {
          await outer.tail.catch(() => undefined);
          if (outer.seq > mark) await undoSince(outer, mark);
        }
        throw e;
      }
    }
    const id = newId(now());
    const acquiredAt = await acquire(id);
    // o prazo conta a partir da AQUISIÇÃO da trava (a recuperação de uma queda anterior pode ter consumido parte do TTL)
    const ctx: TxCtx = { id, deadline: acquiredAt + Math.min(options?.timeout ?? txDeadline, txDeadline), seq: 0, tail: Promise.resolve(), closed: false, rolledBack: false, rows: 0 };
    let result: T;
    try {
      result = await als.run(ctx, () => body(clientRef));
      await ctx.tail; // escritas esquecidas sem await terminam (ou falham) antes do commit
    } catch (e) {
      ctx.closed = true;
      ctx.rolledBack = true;
      if (e instanceof SimulatedCrash) throw e; // "o processo morreu": nada de limpeza
      await ctx.tail.catch(() => undefined);
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          const rows = (await d1.batch([d1.prepare("SELECT undo FROM _Journal WHERE txId = ?1 ORDER BY rowid DESC").bind(id)]))[0]?.results as Array<{ undo: string }> | undefined;
          await applyUndoRows((rows ?? []).map((r) => r.undo), id);
          await releaseLease(id, id);
          done = true;
        } catch (rollbackError) {
          console.error(`[d1-engine] rollback falhou (tentativa ${attempt + 1}/3):`, rollbackError);
          if (attempt < 2) await sleep(100 * (attempt + 1));
        }
      }
      // sem sucesso: marca a trava como VENCIDA agora (o dono continua registrado) para a PRÓXIMA aquisição concluir o desfazer já, sem esperar o TTL
      if (!done) await d1.batch([d1.prepare("UPDATE _Lease SET expiresAt = 0 WHERE id = 1 AND owner = ?1").bind(id)]).catch(() => undefined);
      throw e;
    }
    ctx.closed = true;
    crash("before-commit");
    await commit(id); // COMMIT: apaga o diário e solta a trava de uma vez só — e só se a trava ainda é nossa
    return result;
  }

  // ───────── cliente ─────────

  const extended = deps.base.$extends({
    name: "d1-engine",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }: { model: string; operation: string; args: Row; query: (a: unknown) => Promise<unknown> }) {
          return handle(model, operation, args, query);
        },
      },
    },
  }) as Record<string | symbol, unknown>;

  const client = new Proxy(extended, {
    get(target, prop) {
      if (prop === "$transaction") return transaction;
      if (prop === "$connect" || prop === "$disconnect") return async () => undefined;
      if (prop === "$executeRaw" || prop === "$executeRawUnsafe") {
        // SQL cru não entra no diário: dentro de uma transação não teria como ser desfeito. Fora dela, passa pela trava de escrita.
        const run = Reflect.get(target, prop, target) as (...a: unknown[]) => Promise<unknown>;
        return (...a: unknown[]) => {
          const ctx = als.getStore();
          if (ctx && !ctx.closed) return Promise.reject(new Error("d1-engine: SQL cru ($executeRaw) não é suportado dentro de transação: o desfazer não o alcança."));
          return withLease(() => run.apply(target, a));
        };
      }
      return Reflect.get(target, prop, target);
    },
  });
  clientRef = client;

  /** Para o painel do dono: quarentena do diário (deve ser 0), diário pendente e trava vencida (queda no meio). */
  async function health(): Promise<{ dead: number; pending: number; staleLease: boolean }> {
    const [dead, pending, lease] = await d1.batch([
      d1.prepare("SELECT COUNT(*) AS n FROM _JournalDead"),
      d1.prepare("SELECT COUNT(*) AS n FROM _Journal"),
      d1.prepare("SELECT owner, expiresAt FROM _Lease WHERE id = 1"),
    ]);
    const l = (lease?.results?.[0] ?? {}) as { owner?: string | null; expiresAt?: number };
    return {
      dead: Number((dead?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
      pending: Number((pending?.results?.[0] as { n?: number } | undefined)?.n ?? 0),
      staleLease: !!l.owner && (l.expiresAt ?? 0) < now(),
    };
  }

  return {
    client: client as unknown,
    health,
    /** Roda `fn` já dentro da trava (para tarefas de manutenção). */
    withLease,
    /** Só para testes. */
    internals: { acquire, releaseLease, applyUndoRows },
  };
}
