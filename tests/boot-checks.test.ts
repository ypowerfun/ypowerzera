import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { assertNoDemoAccounts } from "@/server/boot-checks";

describe("subir em produção com o banco de demonstração", () => {
  // O banco de teste é compartilhado com outros arquivos: este teste só mexe na própria conta.
  afterEach(async () => {
    await db.user.deleteMany({ where: { username: "demo_boot_check" } });
  });

  it("recusa quando existe conta @primearena.local (senha pública no README)", async () => {
    await db.user.create({ data: { email: "boot-check@primearena.local", username: "demo_boot_check", displayName: "Demo", passwordHash: "x", role: "ADMIN", emailVerifiedAt: new Date() } });
    await expect(assertNoDemoAccounts()).rejects.toThrow(/conta\(s\) de demonstração/);
  });
});
