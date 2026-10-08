import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma-d1-node/client";
import { DbBusyError, SimulatedCrash } from "../../src/lib/d1-engine";
import { createTestClient, createTestD1, type TestD1 } from "./harness";

/**
 * Motor de transações do D1 (src/lib/d1-engine.ts) contra um D1 de verdade (Miniflare).
 * O que se prova aqui: tudo-ou-nada, isolamento (uma escrita por vez), recuperação de queda e o fechamento das brechas
 * conhecidas (chave natural repetida, cascata, SetNull, Json, datas, brechas de trava).
 */

let t: TestD1;
beforeAll(async () => {
  t = await createTestD1();
});
afterAll(async () => {
  await t.dispose();
});

let n = 0;
const key = (p = "k") => `${p}-${Date.now().toString(36)}-${n++}`;
const user = (db: ReturnType<typeof createTestClient>["db"], tag = key("u")) =>
  db.user.create({ data: { email: `${tag}@t.dev`, username: tag, displayName: tag, passwordHash: "x" } });

async function dump(base: ReturnType<typeof createTestClient>["base"]) {
  const b = base as unknown as Record<string, { findMany: (a?: unknown) => Promise<unknown[]> }>;
  const out: Record<string, unknown[]> = {};
  for (const m of ["siteSetting", "user", "session", "notification", "auditLog", "wallet", "ledgerEntry", "team", "teamMember"]) {
    out[m] = (await b[m].findMany({ orderBy: undefined })).map((r) => JSON.parse(JSON.stringify(r))).sort((a, c) => JSON.stringify(a).localeCompare(JSON.stringify(c)));
  }
  return JSON.stringify(out);
}
const journalCount = async (d1: TestD1["d1"]) =>
  ((await (d1.prepare("SELECT COUNT(*) AS c FROM _Journal") as unknown as { all(): Promise<{ results: Array<{ c: number }> }> }).all()).results[0].c);
const lease = async (d1: TestD1["d1"]) =>
  (await (d1.prepare("SELECT owner, expiresAt FROM _Lease WHERE id = 1") as unknown as { all(): Promise<{ results: Array<{ owner: string | null; expiresAt: number }> }> }).all()).results[0];

describe("confirmação e desfazer", () => {
  it("commit grava tudo, esvazia o diário e solta a trava", async () => {
    const { db } = createTestClient(t.d1);
    const a = key();
    await db.$transaction(async (tx) => {
      await tx.siteSetting.create({ data: { key: a, value: "1" } });
      await tx.siteSetting.update({ where: { key: a }, data: { value: "2" } });
    });
    expect((await db.siteSetting.findUnique({ where: { key: a } }))?.value).toBe("2");
    expect(await journalCount(t.d1)).toBe(0);
    expect((await lease(t.d1)).owner).toBeNull();
  });

  it("erro no meio desfaz criação, atualização e remoção (tudo-ou-nada)", async () => {
    const { db, base } = createTestClient(t.d1);
    const [a, b, c] = [key(), key(), key()];
    await db.siteSetting.create({ data: { key: a, value: "A" } });
    await db.siteSetting.create({ data: { key: b, value: "B" } });
    const before = await dump(base);
    await expect(
      db.$transaction(async (tx) => {
        await tx.siteSetting.update({ where: { key: a }, data: { value: "A2" } });
        await tx.siteSetting.delete({ where: { key: b } });
        await tx.siteSetting.create({ data: { key: c, value: "C" } });
        await tx.siteSetting.updateMany({ where: { key: { in: [a, c] } }, data: { value: "ZZ" } });
        throw new Error("falha no fim");
      }),
    ).rejects.toThrow("falha no fim");
    expect(await dump(base)).toBe(before);
    expect(await journalCount(t.d1)).toBe(0);
    expect((await lease(t.d1)).owner).toBeNull();
  });

  it("a forma em LISTA também é atômica (a segunda falha desfaz a primeira)", async () => {
    const { db } = createTestClient(t.d1);
    const k = key();
    await expect(
      db.$transaction([db.siteSetting.create({ data: { key: k, value: "1" } }), db.siteSetting.create({ data: { key: k, value: "dup" } })]),
    ).rejects.toThrow();
    expect(await db.siteSetting.findUnique({ where: { key: k } })).toBeNull();
  });

  it("chave natural repetida: a criação que falha NÃO apaga a linha que já existia ao desfazer", async () => {
    const { db } = createTestClient(t.d1);
    const k = key();
    await db.siteSetting.create({ data: { key: k, value: "original" } });
    await expect(
      db.$transaction(async (tx) => {
        await tx.siteSetting.create({ data: { key: k, value: "intruso" } }); // P2002
      }),
    ).rejects.toThrow();
    expect((await db.siteSetting.findUnique({ where: { key: k } }))?.value).toBe("original");
    // mesmo capturando o erro dentro da transação e falhando depois
    await expect(
      db.$transaction(async (tx) => {
        await tx.siteSetting.create({ data: { key: k, value: "intruso" } }).catch(() => undefined);
        throw new Error("depois");
      }),
    ).rejects.toThrow("depois");
    expect((await db.siteSetting.findUnique({ where: { key: k } }))?.value).toBe("original");
  });

  it("cascata: apagar o pai dentro da transação e desfazer devolve pai e filhos", async () => {
    const { db, base } = createTestClient(t.d1);
    const u = await user(db);
    await db.notification.createMany({ data: [1, 2, 3].map((i) => ({ userId: u.id, kind: "k", title: `t${i}`, body: "b" })) });
    await db.session.create({ data: { id: key("s"), userId: u.id, expiresAt: new Date(Date.now() + 1e6) } });
    const before = await dump(base);
    await expect(
      db.$transaction(async (tx) => {
        await tx.user.delete({ where: { id: u.id } });
        expect(await tx.notification.count({ where: { userId: u.id } })).toBe(0); // a cascata do banco apagou os filhos
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    expect(await dump(base)).toBe(before);
    expect(await db.notification.count({ where: { userId: u.id } })).toBe(3);
  });

  it("SetNull: o vínculo anulado pelo banco volta ao desfazer", async () => {
    const { db, base } = createTestClient(t.d1);
    const u = await user(db);
    const w = await db.wallet.create({ data: { kind: "PLATFORM", id: key("w") } });
    await db.auditLog.create({ data: { actorId: u.id, action: "x", entity: "e", entityId: "1" } });
    // Challenge.opponentTeam é SetNull: usamos Team + Challenge só se o esquema permitir; aqui basta provar a mecânica via Wallet.team (SetNull)
    const team = await db.team.create({ data: { name: key("T"), tag: "TT", slug: key("slug"), ownerId: u.id } });
    const wt = await db.wallet.create({ data: { kind: "TEAM", teamId: team.id } });
    const before = await dump(base);
    await expect(
      db.$transaction(async (tx) => {
        await tx.team.delete({ where: { id: team.id } }).catch(() => undefined); // Restrict/SetNull conforme o esquema: se o banco recusar, o desfazer não pode estragar nada
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    expect(await dump(base)).toBe(before);
    expect(w.id).toBeTruthy();
    expect(wt.teamId).toBe(team.id);
  });

  it("colunas Json (nulo e valor), datas e inteiros voltam exatamente como eram", async () => {
    const { db } = createTestClient(t.d1);
    const when = new Date("2026-03-04T05:06:07.089Z");
    const withMeta = await db.auditLog.create({ data: { action: "a", entity: "e", entityId: "1", meta: { x: [1, { y: "z" }], ok: true }, createdAt: when } });
    const noMeta = await db.auditLog.create({ data: { action: "a", entity: "e", entityId: "2", createdAt: when } });
    await expect(
      db.$transaction(async (tx) => {
        await tx.auditLog.update({ where: { id: withMeta.id }, data: { meta: Prisma.DbNull, createdAt: new Date(0), action: "mudou" } });
        await tx.auditLog.update({ where: { id: noMeta.id }, data: { meta: { novo: 1 } } });
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    const a = await db.auditLog.findUniqueOrThrow({ where: { id: withMeta.id } });
    const b = await db.auditLog.findUniqueOrThrow({ where: { id: noMeta.id } });
    expect(a.meta).toEqual({ x: [1, { y: "z" }], ok: true });
    expect(a.createdAt.toISOString()).toBe(when.toISOString());
    expect(a.action).toBe("a");
    expect(b.meta).toBeNull();
  });

  it("upsert: ramo de criação e ramo de atualização são desfeitos", async () => {
    const { db } = createTestClient(t.d1);
    const [novo, velho] = [key(), key()];
    await db.siteSetting.create({ data: { key: velho, value: "v0" } });
    await expect(
      db.$transaction(async (tx) => {
        await tx.siteSetting.upsert({ where: { key: novo }, create: { key: novo, value: "c" }, update: { value: "u" } });
        await tx.siteSetting.upsert({ where: { key: velho }, create: { key: velho, value: "c" }, update: { value: "u" } });
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    expect(await db.siteSetting.findUnique({ where: { key: novo } })).toBeNull();
    expect((await db.siteSetting.findUnique({ where: { key: velho } }))?.value).toBe("v0");
  });

  it("incrementos concorrentes dentro de transações não perdem nenhuma soma e um erro não deixa resíduo", async () => {
    const { db } = createTestClient(t.d1);
    const w = await db.wallet.create({ data: { kind: "PLATFORM", id: key("w") } });
    const run = (i: number) =>
      db.$transaction(async (tx) => {
        const cur = await tx.wallet.findUniqueOrThrow({ where: { id: w.id } });
        await tx.wallet.update({ where: { id: w.id }, data: { balanceCents: cur.balanceCents + 10 } }); // ler-e-escrever: só é correto se as transações forem serializadas
        if (i % 4 === 0) throw new Error("falha " + i);
      }).catch(() => undefined);
    await Promise.all(Array.from({ length: 12 }, (_, i) => run(i + 1)));
    // 12 transações, 3 falham (i=4,8,12) => 9 somas de 10
    expect((await db.wallet.findUniqueOrThrow({ where: { id: w.id } })).balanceCents).toBe(90);
  });

  it("escrita avulsa espera a transação em andamento e nunca a atravessa", async () => {
    const { db } = createTestClient(t.d1);
    const k = key();
    await db.siteSetting.create({ data: { key: k, value: "0" } });
    const order: string[] = [];
    const tx = db.$transaction(async (t2) => {
      order.push("tx-inicio");
      await t2.siteSetting.update({ where: { key: k }, data: { value: "tx" } });
      await new Promise((r) => setTimeout(r, 400));
      order.push("tx-fim");
    });
    await new Promise((r) => setTimeout(r, 100));
    const avulsa = db.siteSetting.update({ where: { key: k }, data: { value: "avulsa" } }).then(() => order.push("avulsa"));
    await Promise.all([tx, avulsa]);
    expect(order).toEqual(["tx-inicio", "tx-fim", "avulsa"]);
    expect((await db.siteSetting.findUnique({ where: { key: k } }))?.value).toBe("avulsa");
  });

  it("usar o `db` global dentro da transação se junta a ela (sem travar) e é desfeito junto", async () => {
    const { db } = createTestClient(t.d1);
    const k = key();
    await expect(
      db.$transaction(async () => {
        await db.siteSetting.create({ data: { key: k, value: "x" } });
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    expect(await db.siteSetting.findUnique({ where: { key: k } })).toBeNull();
  });

  it("transação dentro de transação se junta à de fora", async () => {
    const { db } = createTestClient(t.d1);
    const k = key();
    await expect(
      db.$transaction(async (tx) => {
        await (tx as unknown as { $transaction: (fn: (i: typeof tx) => Promise<void>) => Promise<void> }).$transaction(async (inner) => {
          await inner.siteSetting.create({ data: { key: k, value: "x" } });
        });
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    expect(await db.siteSetting.findUnique({ where: { key: k } })).toBeNull();
  });

  it("escrita aninhada em transação é recusada (não dá para desfazer com segurança)", async () => {
    const { db } = createTestClient(t.d1);
    const u = await user(db);
    await expect(
      db.$transaction(async (tx) => {
        await tx.team.create({ data: { name: key("N"), tag: "NN", slug: key("n"), ownerId: u.id, members: { create: { userId: u.id, role: "CAPTAIN" } } } });
      }),
    ).rejects.toThrow(/aninhada/);
  });

  it("passou do prazo: novas escritas são recusadas e o que já foi feito é desfeito", async () => {
    let clock = 1_000_000;
    const { db, base } = createTestClient(t.d1, { now: () => clock, txDeadlineMs: 5_000 });
    const k = key();
    const before = await dump(base);
    await expect(
      db.$transaction(async (tx) => {
        await tx.siteSetting.create({ data: { key: k, value: "1" } });
        clock += 6_000;
        await tx.siteSetting.update({ where: { key: k }, data: { value: "2" } });
      }),
    ).rejects.toThrow(/demorou demais/);
    expect(await dump(base)).toBe(before);
  });
});

describe("queda no meio (o servidor morre) e recuperação", () => {
  it("queda depois de escrever: o próximo a tomar a trava desfaz a transação inacabada", async () => {
    let clock = 5_000_000;
    const crashing = createTestClient(t.d1, { now: () => clock, crashPoint: (p) => { if (p === "after-write") throw new SimulatedCrash(p); } });
    const { db: other, base } = createTestClient(t.d1, { now: () => clock, sleep: async (ms) => { clock += ms * 500; }, acquireMaxWaitMs: 600_000 });
    const k = key();
    await other.siteSetting.create({ data: { key: k, value: "antes" } });
    const before = await dump(base);

    await expect(
      crashing.db.$transaction(async (tx) => {
        await tx.siteSetting.update({ where: { key: k }, data: { value: "meio" } });
        await tx.siteSetting.create({ data: { key: key(), value: "lixo" } });
      }),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    // o "processo morreu": a trava continua com o dono e o diário continua gravado
    expect((await lease(t.d1)).owner).not.toBeNull();
    expect(await journalCount(t.d1)).toBeGreaterThan(0);

    // outro Worker quer escrever: espera a trava vencer, desfaz a transação inacabada e só então escreve
    await other.siteSetting.create({ data: { key: key(), value: "novo" } });
    const after = JSON.parse(await dump(base));
    expect(after.siteSetting.some((r: { key: string; value: string }) => r.key === k && r.value === "antes")).toBe(true);
    expect(after.siteSetting.some((r: { value: string }) => r.value === "meio" || r.value === "lixo")).toBe(false);
    expect(await journalCount(t.d1)).toBe(0);
    void before;
  });

  it("queda ANTES do commit também é desfeita; queda depois do commit não desfaz nada", async () => {
    let clock = 9_000_000;
    const mk = (point: string) => createTestClient(t.d1, { now: () => clock, crashPoint: (p) => { if (p === point) throw new SimulatedCrash(p); } });
    const { db: other } = createTestClient(t.d1, { now: () => clock, sleep: async (ms) => { clock += ms * 500; }, acquireMaxWaitMs: 600_000 });
    const k = key();
    await expect(
      mk("before-commit").db.$transaction(async (tx) => {
        await tx.siteSetting.create({ data: { key: k, value: "nao-confirmada" } });
      }),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    await other.siteSetting.create({ data: { key: key(), value: "qualquer" } }); // dispara a recuperação
    expect(await other.siteSetting.findUnique({ where: { key: k } })).toBeNull();

    // transação confirmada normalmente: nada a recuperar mais tarde
    const k2 = key();
    await other.$transaction(async (tx) => {
      await tx.siteSetting.create({ data: { key: k2, value: "confirmada" } });
    });
    await other.siteSetting.create({ data: { key: key(), value: "outra" } });
    expect((await other.siteSetting.findUnique({ where: { key: k2 } }))?.value).toBe("confirmada");
  });

  it("quem perdeu a trava (parou além do prazo) é barrado antes de escrever mais", async () => {
    let clock = 20_000_000;
    const slow = createTestClient(t.d1, { now: () => clock });
    const { db: thief } = createTestClient(t.d1, { now: () => clock });
    const k = key();
    let reached = false;
    await expect(
      slow.db.$transaction(async (tx) => {
        await tx.siteSetting.create({ data: { key: k, value: "primeira" } });
        // simula uma parada longa: a trava vence e outro Worker a toma (e desfaz o que a primeira já tinha feito)
        clock += 41_000;
        await thief.siteSetting.create({ data: { key: key(), value: "ladrao" } });
        await tx.siteSetting.update({ where: { key: k }, data: { value: "segunda" } });
        reached = true;
      }),
    ).rejects.toThrow();
    expect(reached).toBe(false);
    expect(await thief.siteSetting.findUnique({ where: { key: k } })).toBeNull();
  });
});

describe("trava", () => {
  it("sem conseguir a trava no prazo, falha com erro amigável (sem derrubar nada)", async () => {
    let clock = 30_000_000;
    const holder = createTestClient(t.d1, { now: () => clock });
    const waiter = createTestClient(t.d1, { now: () => clock, sleep: async (ms) => { clock += ms * 40; }, acquireMaxWaitMs: 2_000, leaseTtlMs: 600_000 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holding = holder.db.$transaction(async (tx) => {
      await tx.siteSetting.create({ data: { key: key(), value: "segura" } });
      await gate;
    });
    await new Promise((r) => setTimeout(r, 300));
    await expect(waiter.db.siteSetting.create({ data: { key: key(), value: "espera" } })).rejects.toBeInstanceOf(DbBusyError);
    release();
    await holding;
  });

  it("modelos isentos (limite de taxa) não tomam a trava", async () => {
    const holder = createTestClient(t.d1);
    const { db } = createTestClient(t.d1, { acquireMaxWaitMs: 500 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holding = holder.db.$transaction(async () => {
      await gate;
    });
    await new Promise((r) => setTimeout(r, 200));
    await db.rateLimit.create({ data: { key: key("rl"), count: 1, resetAt: new Date(Date.now() + 1000) } }); // não espera
    release();
    await holding;
  });
});
