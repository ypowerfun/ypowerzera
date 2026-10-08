import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { effectiveRole, verifyEmail } from "@/server/auth";
import { testOutbox } from "@/server/mailer";
import { criarAdmin } from "../scripts/lib/criar-admin";

const input = { email: "owner@bootstrap.example.com", username: "bootstrap_owner", displayName: "Dono" };
async function clean() {
  const where = { email: input.email };
  await db.authToken.deleteMany({ where: { user: where } });
  await db.session.deleteMany({ where: { user: where } });
  await db.user.deleteMany({ where });
  testOutbox.length = 0;
}
beforeEach(async () => {
  vi.stubEnv("ADMIN_EMAILS", input.email);
  await clean();
});
afterEach(async () => {
  await clean();
  vi.unstubAllEnvs();
});

it("exige e-mail autorizado antes de gravar uma conta", async () => {
  vi.stubEnv("ADMIN_EMAILS", "outro@bootstrap.example.com");
  await expect(criarAdmin(input)).rejects.toThrow(/ADMIN_EMAILS/);
  expect(await db.user.count({ where: { email: input.email } })).toBe(0);
});
it("só concede acesso administrativo após confirmação pelo fluxo existente", async () => {
  await criarAdmin(input);
  const pending = await db.user.findUniqueOrThrow({ where: { email: input.email } });
  expect(pending.role).toBe("USER");
  expect(pending.emailVerifiedAt).toBeNull();
  expect(effectiveRole(pending)).toBe("USER");
  const token = testOutbox[0].text.match(/verificar-email\/([A-Za-z0-9_-]+)/)![1];
  const result = await verifyEmail(token);
  expect(result.resetToken).toBeTruthy();
  expect(effectiveRole(await db.user.findUniqueOrThrow({ where: { id: pending.id } }))).toBe("ADMIN");
});
it("não sobrescreve contas e permite reenviar somente enquanto pendentes", async () => {
  await criarAdmin(input);
  const original = await db.user.findUniqueOrThrow({ where: { email: input.email } });
  await expect(criarAdmin(input)).rejects.toThrow(/já existe/);
  await criarAdmin(input, true);
  expect(testOutbox).toHaveLength(2);
  expect((await db.user.findUniqueOrThrow({ where: { id: original.id } })).passwordHash).toBe(original.passwordHash);
  await db.user.update({ where: { id: original.id }, data: { bannedAt: new Date() } });
  await expect(criarAdmin(input, true)).rejects.toThrow(/suspensa/);
});
it("não cria conta ao pedir reenvio para endereço inexistente", async () => {
  await expect(criarAdmin(input, true)).rejects.toThrow(/não encontrada/);
  expect(await db.user.count({ where: { email: input.email } })).toBe(0);
});
