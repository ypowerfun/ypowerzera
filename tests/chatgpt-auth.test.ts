import { afterEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => ({ headers: new Headers(), cookieReads: 0 }));
vi.mock("next/headers", () => ({ headers: async () => request.headers, cookies: async () => { request.cookieReads++; return { get: () => ({ value: "old-session" }) }; } }));
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "@/server/chatgpt-auth";
import { createChatGPTProfile, findChatGPTProfile } from "@/server/chatgpt-users";
import { getCurrentUser, requireActionAdmin, requireActionUser } from "@/server/session";
import { db } from "@/lib/db";
import { effectiveRole } from "@/server/auth";
import { makeUser, uid } from "./factories";
const identity = () => { const id = uid(); return { userId: `subject-${id}`, email: `${id}@test.dev`, fullName: null, displayName: "Pessoa" }; };
const profile = () => ({ username: `j${uid()}`, displayName: "Jogador Prime", terms: true });
afterEach(() => { process.env.AUTH_PROVIDER = "local"; delete process.env.CHATGPT_ADMIN_USER_IDS; delete process.env.ADMIN_EMAILS; request.headers = new Headers(); request.cookieReads = 0; });
describe("login ChatGPT", () => {
 it("anonimato rejeita ações e ignora cookies legados", async () => {
  process.env.AUTH_PROVIDER = "chatgpt";
  expect(await getCurrentUser()).toBeNull();
  await expect(requireActionUser()).rejects.toThrow(/Entre com sua conta/);
  expect(request.cookieReads).toBe(0);
 });
 it("decodifica nomes somente com encoding declarado e exige subject", async () => {
  request.headers = new Headers({ "oai-authenticated-user-email": "a@test.dev", "oai-authenticated-user-full-name": "Jos%C3%A9" });
  expect(await getChatGPTUser()).toBeNull();
  request.headers.set("oai-authenticated-user-id", "subject");
  expect((await getChatGPTUser())?.fullName).toBeNull();
  request.headers.set("oai-authenticated-user-full-name-encoding", "percent-encoded-utf-8");
  expect((await getChatGPTUser())?.fullName).toBe("José");
 });
 it("return_to aceita somente caminhos internos e rejeita endpoints de autenticação", () => {
  for (const value of ["https://evil.test", "//evil.test", "/\\evil.test", "/signin-with-chatgpt", "/callback", "/signout-with-chatgpt"]) expect(chatGPTSignInPath(value)).toBe("/signin-with-chatgpt?return_to=%2F");
  expect(chatGPTSignOutPath("/viradao?evento=abc")).toBe("/signout-with-chatgpt?return_to=%2Fviradao%3Fevento%3Dabc");
 });
 it("onboarding repetido ou concorrente cria um único perfil por subject", async () => {
  process.env.AUTH_PROVIDER = "chatgpt";
  const who = identity(), input = profile();
  const users = await Promise.all([createChatGPTProfile(who, input), createChatGPTProfile(who, input)]);
  expect(users[0].id).toBe(users[1].id);
  expect(await db.chatGPTIdentity.count({ where: { subject: who.userId } })).toBe(1);
  expect((await findChatGPTProfile({ ...who, email: "changed@test.dev" }))?.id).toBe(users[0].id);
 });
 it("não vincula uma conta antiga pelo e-mail nem concede admin por ADMIN_EMAILS", async () => {
  const existing = await makeUser(); process.env.AUTH_PROVIDER = "chatgpt";
  process.env.ADMIN_EMAILS = existing.email;
  const stored = await db.user.findUniqueOrThrow({ where: { id: existing.id } });
  expect(effectiveRole(stored)).toBe("USER");
  await expect(createChatGPTProfile({ ...identity(), email: existing.email! }, profile())).rejects.toThrow(/vincular/);
  expect(await db.chatGPTIdentity.findUnique({ where: { userId: existing.id } })).toBeNull();
 });
 it("permissões administrativas dependem de subject e a suspensão prevalece", async () => {
  process.env.AUTH_PROVIDER = "chatgpt"; const who = identity();
  const user = await createChatGPTProfile(who, profile());
  request.headers = new Headers({ "oai-authenticated-user-id": who.userId, "oai-authenticated-user-email": who.email });
  await expect(requireActionAdmin()).rejects.toThrow(/administradores/);
  process.env.CHATGPT_ADMIN_USER_IDS = who.userId;
  expect((await requireActionAdmin()).role).toBe("ADMIN");
  await db.user.update({ where: { id: user.id }, data: { bannedAt: new Date() } });
  await expect(findChatGPTProfile(who)).rejects.toThrow(/suspensa/);
 });
 it("exige os termos e protege nomes reservados", async () => {
  process.env.AUTH_PROVIDER = "chatgpt";
  await expect(createChatGPTProfile(identity(), { ...profile(), terms: false })).rejects.toThrow(/Termos/);
  await expect(createChatGPTProfile(identity(), { ...profile(), username: "admin" })).rejects.toThrow(/não está disponível/);
 });
});
