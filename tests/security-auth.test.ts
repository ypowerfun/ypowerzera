import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { safeNext } from "@/lib/action-helpers";
import { hashPassword } from "@/lib/crypto";
import { normalizeClientIp } from "@/lib/ip";
import { cleanDisplayName, effectiveRole, getUserBySessionToken, login, registerUser, requestPasswordReset, resetPassword, verifyEmail } from "@/server/auth";
import { purgeExpired } from "@/server/cron";
import { lastMailTo, testOutbox } from "@/server/mailer";
import { rateLimit } from "@/server/rate-limit";

const base = { username: "vitima_1", displayName: "Vítima", password: "SenhaBoa#2026" };

async function clean() {
  const mine = { email: { endsWith: "@sec.example.com" } };
  await db.session.deleteMany({ where: { user: mine } });
  await db.authToken.deleteMany({ where: { user: mine } });
  await db.rateLimit.deleteMany();
  await db.user.deleteMany({ where: mine });
  testOutbox.length = 0;
  delete process.env.ADMIN_EMAILS;
}

const tokenFrom = (to: string, marker: string) => lastMailTo(to)!.text.match(new RegExp(`${marker}/([A-Za-z0-9_-]+)`))![1];

describe("safeNext: redirecionamento só para dentro do site", () => {
  it.each([
    ["/torneios", "/torneios"],
    ["/torneios?pagina=2#topo", "/torneios?pagina=2#topo"],
    ["/conta/contas?jogo=lol", "/conta/contas?jogo=lol"],
  ])("aceita %s", (input, out) => expect(safeNext(input)).toBe(out));

  it.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["https://evil.com"],
    ["javascript:alert(1)"],
    ["/\t/evil.com"], // o navegador apaga o TAB e vira //evil.com
    ["/\n/evil.com"],
    ["/\r/evil.com"],
    ["/\u0000/evil.com"],
    ["/\u0085/evil.com"], // NEL: também é caractere de controle
    ["evil.com"],
    [""],
  ])("recusa %j", (input) => expect(safeNext(input)).toBe("/"));

  it("recusa valor enorme e usa o destino padrão informado", () => {
    expect(safeNext("/" + "a".repeat(5000))).toBe("/");
    expect(safeNext("//x", "/conta")).toBe("/conta");
    expect(safeNext(null)).toBe("/");
  });
});

describe("IP do cliente nos limites", () => {
  it("IPv4 fica como está; IPv6 agrupa pelo prefixo /64; IPv4 mapeado vira IPv4", () => {
    expect(normalizeClientIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeClientIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeClientIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(normalizeClientIp("2001:db8:1:2:1111:2222:3333:4444")).toBe("2001:db8:1:2::/64");
    expect(normalizeClientIp("2001:DB8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeClientIp("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(normalizeClientIp("::1")).toBe("0:0:0:0::/64");
  });
  it("lixo não vira chave gigante", () => {
    expect(normalizeClientIp("x".repeat(500)).length).toBeLessThanOrEqual(45);
    expect(normalizeClientIp("zzzz:zz::1").length).toBeLessThanOrEqual(45);
  });
});

describe("limitador de tentativas é atômico", () => {
  beforeEach(clean);

  it("50 pedidos simultâneos passam exatamente 5 vezes", async () => {
    const res = await Promise.allSettled(Array.from({ length: 50 }, () => rateLimit("teste:rajada", 5, 60)));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const rejected = res.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(45);
    expect(rejected.every((r) => r.reason?.code === "RATE_LIMIT")).toBe(true);
    expect((await db.rateLimit.findUnique({ where: { key: "teste:rajada" } }))?.count).toBe(5);
  });

  it("janela vencida reabre", async () => {
    await rateLimit("teste:janela", 1, 60);
    await expect(rateLimit("teste:janela", 1, 60)).rejects.toThrow();
    await db.rateLimit.update({ where: { key: "teste:janela" }, data: { resetAt: new Date(Date.now() - 1000) } });
    await expect(rateLimit("teste:janela", 1, 60)).resolves.toBeUndefined();
  });
});

describe("login resiste a rajada, bloqueio de terceiros e chaves gigantes", () => {
  beforeEach(clean);

  it("30 palpites simultâneos: só 8 chegam a testar a senha", async () => {
    await registerUser({ ...base, email: "vitima@sec.example.com" });
    const res = await Promise.all(
      Array.from({ length: 30 }, (_, i) => login({ identifier: "vitima@sec.example.com", password: `palpite-${i}-errado` }, { ip: "9.9.9.9" }).then(() => "ok", (e: Error) => e.message)),
    );
    expect(res.filter((m) => /incorretos/.test(m))).toHaveLength(8);
    expect(res.filter((m) => /Muitas tentativas/.test(m))).toHaveLength(22);
  });

  it("quem erra de fora não bloqueia a conta para o dono, que entra de outro IP", async () => {
    await registerUser({ ...base, email: "vitima@sec.example.com" });
    for (let i = 0; i < 12; i++) await login({ identifier: "vitima@sec.example.com", password: "errada#1234" }, { ip: "6.6.6.6" }).catch(() => undefined);
    await expect(login({ identifier: "vitima@sec.example.com", password: "errada#1234" }, { ip: "6.6.6.6" })).rejects.toThrow(/Muitas tentativas/);
    const ok = await login({ identifier: "vitima@sec.example.com", password: base.password }, { ip: "7.7.7.7" });
    expect(ok.user.email).toBe("vitima@sec.example.com");
  });

  it("logins corretos não gastam o limite do IP nem da conta", async () => {
    await registerUser({ ...base, email: "vitima@sec.example.com" });
    for (let i = 0; i < 45; i++) {
      await login({ identifier: "vitima@sec.example.com", password: base.password }, { ip: "8.8.8.8" });
    }
  });

  it("identificador gigante é recusado sem criar linha no banco", async () => {
    const before = await db.rateLimit.count();
    await expect(login({ identifier: "a".repeat(900_000), password: "qualquer#123" }, { ip: "5.5.5.5" })).rejects.toThrow(/incorretos/);
    expect(await db.rateLimit.count()).toBe(before);
  });

  it("'esqueci a senha' com e-mail gigante ou inválido não cria chave no banco e responde igual", async () => {
    await requestPasswordReset("a".repeat(900_000) + "@x.com", { ip: "4.4.4.4" });
    await requestPasswordReset("sem-arroba", { ip: "4.4.4.4" });
    const keys = (await db.rateLimit.findMany({ select: { key: true } })).map((r) => r.key);
    expect(keys.every((k) => k.length < 100)).toBe(true);
    expect(keys.some((k) => k.startsWith("reset:email:"))).toBe(false);
  });
});

describe("e-mail de administrador: quem se cadastra primeiro não ganha o acesso", () => {
  beforeEach(clean);

  it("ao confirmar, a senha e a sessão do invasor são descartadas e só o dono do e-mail cria a nova senha", async () => {
    process.env.ADMIN_EMAILS = "dono@sec.example.com";
    // 1) o invasor cadastra o e-mail do dono com uma senha dele e já fica logado
    await registerUser({ ...base, email: "dono@sec.example.com", username: "invasor_1", password: "SenhaDoInvasor#1" });
    const attacker = await login({ identifier: "dono@sec.example.com", password: "SenhaDoInvasor#1" }, { ip: "1.1.1.1" });
    // 2) o dono recebe o e-mail de confirmação e clica
    const verifyToken = tokenFrom("dono@sec.example.com", "verificar-email");
    const res = await verifyEmail(verifyToken);
    expect(res.resetToken).toBeTruthy();
    // 3) a sessão do invasor morreu e a senha dele não funciona mais, nem agora que o e-mail está confirmado
    expect(await getUserBySessionToken(attacker.token)).toBeNull();
    await expect(login({ identifier: "dono@sec.example.com", password: "SenhaDoInvasor#1" }, { ip: "1.1.1.1" })).rejects.toThrow(/incorretos/);
    // 4) o dono cria a senha pelo link e vira administrador
    await resetPassword(res.resetToken!, "SenhaDoDono#2026");
    const owner = await login({ identifier: "dono@sec.example.com", password: "SenhaDoDono#2026" }, { ip: "2.2.2.2" });
    const me = await getUserBySessionToken(owner.token);
    expect(me?.role).toBe("ADMIN");
  });

  it("e-mail que não é de administrador continua com o fluxo simples (senha mantida)", async () => {
    process.env.ADMIN_EMAILS = "dono@sec.example.com";
    await registerUser({ ...base, email: "jogador@sec.example.com" });
    const res = await verifyEmail(tokenFrom("jogador@sec.example.com", "verificar-email"));
    expect(res.resetToken).toBeUndefined();
    const ok = await login({ identifier: "jogador@sec.example.com", password: base.password }, { ip: "3.3.3.3" });
    expect(effectiveRole(ok.user)).toBe("USER");
  });

  it("antes de confirmar o e-mail o cargo de administrador não vale", async () => {
    process.env.ADMIN_EMAILS = "dono@sec.example.com";
    const u = await registerUser({ ...base, email: "dono@sec.example.com" });
    const s = await login({ identifier: "dono@sec.example.com", password: base.password }, { ip: "1.1.1.2" });
    expect((await getUserBySessionToken(s.token))?.role).toBe("USER");
    expect(effectiveRole({ email: u.email, role: u.role, emailVerifiedAt: null })).toBe("USER");
  });
});

describe("nome de exibição e nomes reservados", () => {
  beforeEach(clean);

  it("remove quebras de linha, caracteres invisíveis e inversão de texto", () => {
    expect(cleanDisplayName("Ana\n\nSua conta foi suspensa")).toBe("Ana Sua conta foi suspensa");
    expect(cleanDisplayName("A​n‮a")).toBe("Ana");
    expect(cleanDisplayName("  Ana   Maria ")).toBe("Ana Maria");
  });

  it("o cadastro grava o nome já limpo (o texto do e-mail não pode ser falsificado)", async () => {
    const u = await registerUser({ ...base, email: "nome@sec.example.com", displayName: "Ana\n\nconfirme em evil.io" });
    expect(u.displayName).toBe("Ana confirme em evil.io");
    expect(lastMailTo("nome@sec.example.com")!.text.split("\n")[0]).toBe("Olá, Ana confirme em evil.io!");
  });

  it("nome só com caracteres invisíveis é recusado", async () => {
    await expect(registerUser({ ...base, email: "x@sec.example.com", displayName: "​​​" })).rejects.toThrow(/nome de exibição/);
  });

  it.each(["admin", "Suporte", "prime_arena"])("nome de usuário reservado %s é recusado", async (username) => {
    await expect(registerUser({ ...base, email: "r@sec.example.com", username })).rejects.toThrow(/não está disponível/);
  });
});

describe("hash de senha com fila limitada", () => {
  it("rajada enorme: parte é recusada com aviso (não trava o servidor) e as vagas voltam depois", async () => {
    const res = await Promise.allSettled(Array.from({ length: 90 }, () => hashPassword("senha-qualquer#1")));
    const rejected = res.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((r) => r.reason?.code === "RATE_LIMIT")).toBe(true);
    expect(res.some((r) => r.status === "fulfilled")).toBe(true);
    await expect(hashPassword("depois-da-rajada#1")).resolves.toMatch(/^scrypt\$/);
  });
});

describe("limpeza periódica", () => {
  beforeEach(clean);

  it("apaga limites, sessões e links vencidos e mantém o que ainda vale", async () => {
    const u = await registerUser({ ...base, email: "limpa@sec.example.com" });
    const past = new Date(Date.now() - 30 * 86400_000);
    const future = new Date(Date.now() + 3600_000);
    await db.rateLimit.createMany({ data: [{ key: "velho", count: 3, resetAt: past }, { key: "novo", count: 1, resetAt: future }] });
    await db.session.createMany({ data: [{ id: "sess-velha", userId: u.id, expiresAt: past }, { id: "sess-nova", userId: u.id, expiresAt: future }] });
    await db.authToken.create({ data: { userId: u.id, type: "RESET_PASSWORD", tokenHash: "hash-velho", expiresAt: past } });
    const r = await purgeExpired();
    expect(r.rateLimits).toBeGreaterThanOrEqual(1);
    expect(r.sessions).toBe(1);
    expect(r.tokens).toBeGreaterThanOrEqual(1);
    expect(await db.rateLimit.findUnique({ where: { key: "novo" } })).not.toBeNull();
    expect(await db.rateLimit.findUnique({ where: { key: "velho" } })).toBeNull();
    expect(await db.session.findUnique({ where: { id: "sess-nova" } })).not.toBeNull();
    expect(await db.authToken.findUnique({ where: { tokenHash: "hash-velho" } })).toBeNull();
  });
});
