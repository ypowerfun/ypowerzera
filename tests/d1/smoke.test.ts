import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, createTestD1, type TestD1 } from "./harness";

let t: TestD1;
beforeAll(async () => { t = await createTestD1(); });
afterAll(async () => { await t.dispose(); });

describe("fumaça do D1 de teste", () => {
  it("sobe, aplica as migrações e o Prisma conversa com ele", async () => {
    const { db } = createTestClient(t.d1);
    await db.siteSetting.create({ data: { key: "a", value: "1" } });
    expect((await db.siteSetting.findUnique({ where: { key: "a" } }))?.value).toBe("1");
  });
  it("rollback desfaz uma criação e uma atualização", async () => {
    const { db } = createTestClient(t.d1);
    await expect(db.$transaction(async (tx) => {
      await tx.siteSetting.update({ where: { key: "a" }, data: { value: "2" } });
      await tx.siteSetting.create({ data: { key: "b", value: "x" } });
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect((await db.siteSetting.findUnique({ where: { key: "a" } }))?.value).toBe("1");
    expect(await db.siteSetting.findUnique({ where: { key: "b" } })).toBeNull();
  });
});
