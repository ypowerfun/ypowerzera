// @ts-nocheck
// LIMITAÇÃO CONHECIDA (documentada em docs/SITES.md): estes testes marcados com it.fails descrevem cenários que o motor NÃO cobre —
// uma ÚNICA chamada ao D1 parada por mais que o TTL da trava (40 s) entre a conferência e a gravação, ou o Prisma.JsonNull explícito.
// Se um dia o motor passar a cobri-los, o it.fails falha e avisa para trocar por it().
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestD1, type TestD1 } from "./harness";
import { mkEngine, q, uid } from "./engine-attack-helpers";

let t: TestD1;
beforeEach(async () => { t = await createTestD1(); });
afterEach(async () => { await t.dispose(); });

const val = async (key: string) => (await q(t.d1, `SELECT value FROM SiteSetting WHERE key = ?`, key))[0]?.value as string | undefined;

describe("ATK-4: commit falso depois de perder a trava", () => {
  it("a transação é desfeita por outro Worker (trava expirou) mas $transaction devolve sucesso, sem nenhuma escrita depois", async () => {
    let clock = 1_000_000;
    const slow = mkEngine(t.d1, { now: () => clock });
    const thief = mkEngine(t.d1, { now: () => clock });
    const k = uid("a4");
    let outcome = "";
    try {
      await slow.db.$transaction(async (tx) => {
        await tx.siteSetting.create({ data: { key: k, value: "dinheiro" } });
        clock += 41_000; // parada longa (chamada externa lenta): a trava venceu
        await thief.db.siteSetting.create({ data: { key: uid("thief"), value: "x" } }); // o ladrão toma a trava e DESFAZ a transação lenta
        // nenhuma escrita depois: nada barra a transação lenta
      });
      outcome = "SUCESSO (confirmada)";
    } catch (e) {
      outcome = "ERRO: " + (e as Error).message;
    }
    console.log("ATK-4 resultado:", outcome, "| linha gravada pela transação existe?", (await val(k)) !== undefined);
    // contrato: ou a transação confirma COM os dados, ou falha. Nunca "sucesso" sem os dados.
    expect(outcome.startsWith("SUCESSO") ? (await val(k)) !== undefined : true).toBe(true);
  });

  it("variante: relógio de outro Worker 50 s adiantado toma a trava de uma transação VIVA e a desfaz", async () => {
    let clock = 5_000_000;
    const a = mkEngine(t.d1, { now: () => clock });
    const b = mkEngine(t.d1, { now: () => clock + 50_000 }); // relógio adiantado
    const k = uid("a4b");
    let outcome = "";
    try {
      await a.db.$transaction(async (tx) => {
        await tx.siteSetting.create({ data: { key: k, value: "dinheiro" } });
        await b.db.siteSetting.create({ data: { key: uid("b"), value: "x" } }); // b enxerga a trava como vencida (a transação de a tem 0 s de idade)
      });
      outcome = "SUCESSO (confirmada)";
    } catch (e) {
      outcome = "ERRO: " + (e as Error).message;
    }
    console.log("ATK-4b resultado:", outcome, "| dados existem?", (await val(k)) !== undefined);
    expect(outcome.startsWith("SUCESSO") ? (await val(k)) !== undefined : true).toBe(true);
  });
});

describe("ATK-5: janela entre gravar o diário e executar a escrita (trava perdida nesse intervalo)", () => {
  it.fails("a segunda escrita pousa DEPOIS de o ladrão ter desfeito a primeira: sobra metade da transação, e ela 'confirma'", async () => {
    let clock = 10_000_000;
    const thief = mkEngine(t.d1, { now: () => clock });
    let armed = false;
    let pausedOnce = false;
    const a = mkEngine(
      t.d1,
      { now: () => clock },
      () => async (sql) => {
        if (armed && !pausedOnce && /INSERT INTO .*SiteSetting/.test(sql)) {
          pausedOnce = true;
          clock += 41_000; // a trava venceu bem na janela
          await thief.db.siteSetting.create({ data: { key: uid("thief"), value: "x" } }); // rouba, desfaz o diário da transação e escreve
        }
      },
    );
    const kx = uid("x"), ky = uid("y");
    let outcome = "";
    try {
      await a.db.$transaction(async (tx) => {
        await tx.siteSetting.create({ data: { key: kx, value: "debita" } });
        armed = true;
        await tx.siteSetting.create({ data: { key: ky, value: "credita" } });
      });
      outcome = "SUCESSO (confirmada)";
    } catch (e) {
      outcome = "ERRO: " + (e as Error).message;
    }
    const x = await val(kx), y = await val(ky);
    console.log("ATK-5 resultado:", outcome, "| x(debita)=", x, "| y(credita)=", y, "| diário:", (await q(t.d1, "SELECT COUNT(*) AS c FROM _Journal"))[0].c);
    // tudo-ou-nada: ou os dois existem ou nenhum
    expect(x === undefined).toBe(y === undefined);
  });
});

describe("ATK-6: o desfazer da transação (rollback) não é protegido pela trava", () => {
  it.fails("rollback lento, com a trava já vencida, sobrescreve o dado que outro Worker gravou depois (perda de escrita confirmada)", async () => {
    let clock = 20_000_000;
    const thief = mkEngine(t.d1, { now: () => clock });
    const k = uid("a6");
    await thief.db.siteSetting.create({ data: { key: k, value: "v0" } });
    let rollbackPhase = false;
    let paused = false;
    const a = mkEngine(
      t.d1,
      { now: () => clock },
      () => async (sql, _b, phase) => {
        if (phase === "batch" && /SELECT undo FROM _Journal WHERE txId/.test(sql)) rollbackPhase = true;
        if (rollbackPhase && !paused && /^UPDATE .*SiteSetting/.test(sql)) {
          paused = true;
          clock += 41_000; // o rollback ficou parado além do TTL
          await thief.db.siteSetting.update({ where: { key: k }, data: { value: "v-do-ladrao" } }); // outra transação grava e CONFIRMA
          console.log("ATK-6 logo depois da escrita confirmada do outro Worker, valor =", await val(k), "| trava:", JSON.stringify(await q(t.d1, "SELECT owner FROM _Lease")));
        }
      },
    );
    await expect(
      a.db.$transaction(async (tx) => {
        await tx.siteSetting.update({ where: { key: k }, data: { value: "vA" } });
        throw new Error("falha");
      }),
    ).rejects.toThrow("falha");
    const final = await val(k);
    console.log("ATK-6 valor final:", final, "(o esperado é v-do-ladrao: gravado e confirmado depois)");
    expect(final).toBe("v-do-ladrao");
  });
});
