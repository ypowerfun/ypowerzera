import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createTestClient, createTestD1, type TestD1 } from "./harness";

/** scripts/export-to-d1.mjs: leva um banco SQLite do Prime Arena para o D1 (datas em ms viram texto ISO, pais antes dos filhos). */

const root = path.resolve(__dirname, "../..");
let dir: string;
let t: TestD1;
beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "export-d1-"));
  t = await createTestD1();
});
afterAll(async () => {
  await t.dispose();
  rmSync(dir, { recursive: true, force: true });
});

describe("exportação do SQLite para o D1", () => {
  it("copia usuário, organização, time e carteira com as datas certas e recusa contas de demonstração", async () => {
    const file = path.join(dir, "origem.db");
    const url = `file:${file}?connection_limit=1`;
    const push = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], { cwd: root, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8" });
    expect(push.status, push.stderr).toBe(0);

    const src = new PrismaClient({ datasources: { db: { url } } });
    const created = new Date("2026-02-03T04:05:06.789Z");
    const u = await src.user.create({ data: { email: "dono@exemplo.com", username: "dono", displayName: "Dono 'Aspas' Ltda", passwordHash: "x", createdAt: created, emailVerifiedAt: created } });
    const team = await src.team.create({ data: { name: "Time\nCom quebra", tag: "TQ", slug: "time-q", ownerId: u.id } });
    await src.teamMember.create({ data: { teamId: team.id, userId: u.id, role: "CAPTAIN" } });
    const w = await src.wallet.create({ data: { kind: "TEAM", teamId: team.id, balanceCents: 12345 } });
    await src.auditLog.create({ data: { action: "a", entity: "e", entityId: "1", meta: { ok: [1, 2] } } });
    await src.$disconnect();

    const out = path.join(dir, "dados.sql");
    const run = spawnSync("node", ["scripts/export-to-d1.mjs", "--db", file, "--out", out], { cwd: root, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    const sql = readFileSync(out, "utf8");
    expect(sql).toContain("PRAGMA defer_foreign_keys = true;");
    expect(sql).not.toMatch(/"_prisma_migrations"/);
    // pais antes dos filhos
    expect(sql.indexOf('INSERT INTO "User"')).toBeLessThan(sql.indexOf('INSERT INTO "Team"'));
    expect(sql.indexOf('INSERT INTO "Team"')).toBeLessThan(sql.indexOf('INSERT INTO "TeamMember"'));

    for (const stmt of sql.split(/;\n(?=INSERT|PRAGMA|--)/).map((s) => s.trim()).filter((s) => s && !s.startsWith("--"))) {
      await (t.d1.prepare(stmt) as unknown as { run(): Promise<unknown> }).run();
    }
    const { db } = createTestClient(t.d1);
    const user = await db.user.findUniqueOrThrow({ where: { email: "dono@exemplo.com" } });
    expect(user.displayName).toBe("Dono 'Aspas' Ltda");
    expect(user.createdAt.toISOString()).toBe(created.toISOString());
    const tm = await db.team.findUniqueOrThrow({ where: { slug: "time-q" } });
    expect(tm.name).toBe("Time\nCom quebra");
    expect((await db.wallet.findUniqueOrThrow({ where: { teamId: tm.id } })).balanceCents).toBe(12345);
    expect((await db.auditLog.findFirstOrThrow()).meta).toEqual({ ok: [1, 2] });
    // nenhuma data ficou em milissegundos
    const raw = (await (t.d1.prepare("SELECT typeof(createdAt) AS tp FROM User") as unknown as { all(): Promise<{ results: Array<{ tp: string }> }> }).all()).results;
    expect(raw.every((r) => r.tp === "text")).toBe(true);
    void w;

    // contas de demonstração: recusado
    const src2 = new PrismaClient({ datasources: { db: { url } } });
    await src2.user.create({ data: { email: "admin@primearena.local", username: "admin", displayName: "Admin", passwordHash: "x" } });
    await src2.$disconnect();
    const demo = spawnSync("node", ["scripts/export-to-d1.mjs", "--db", file, "--out", path.join(dir, "nao.sql")], { cwd: root, encoding: "utf8" });
    expect(demo.status).toBe(1);
    expect(demo.stderr).toMatch(/demonstra/);
  });
});
