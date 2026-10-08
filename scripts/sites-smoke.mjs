#!/usr/bin/env node
// Teste de fumaça do site MONTADO para o ChatGPT Sites (Cloudflare Workers + D1), rodando localmente no workerd:
//   npm run build:sites && node scripts/sites-smoke.mjs
// Sobe `wrangler dev --local` com um D1 novo, cadastra uma conta num navegador de verdade, confirma o e-mail direto no
// banco (o envio real de e-mail não existe localmente), entra e abre páginas protegidas. Sai com 1 se algo falhar.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SMOKE_PORT || 8799);
const BASE = `http://localhost:${PORT}`;
const persist = mkdtempSync(path.join(os.tmpdir(), "sites-smoke-"));
const devVars = path.join(root, ".dev.vars");
const hadDevVars = existsSync(devVars);
if (hadDevVars) {
  console.error("Já existe um .dev.vars; renomeie-o antes de rodar o teste de fumaça (ele cria o seu próprio).");
  process.exit(1);
}

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${extra ? `  (${extra})` : ""}`);
};

writeFileSync(
  devVars,
  [
    `APP_URL=${BASE}`,
    "APP_SECRET=smoke-test-secret-smoke-test-secret-0123456789",
    "CRON_SECRET=smoke-cron-secret-0123456789abcdef",
    "ADMIN_EMAILS=admin-smoke@exemplo.com",
    'MAIL_FROM="Prime Arena <nao-responda@arena.exemplo.com.br>"',
    "RESEND_API_KEY=re_smoke_test_key_123456",
  ].join("\n") + "\n",
);

const wrangler = (args, opts = {}) => spawnSync("npx", ["wrangler", ...args], { cwd: root, encoding: "utf8", ...opts });
let server = null;
async function stop() {
  // encerra o grupo inteiro (npx → servidor → workerd); só matar o npx deixaria o servidor vivo na porta
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 500));
  rmSync(devVars, { force: true });
  rmSync(persist, { recursive: true, force: true });
}

try {
  const mig = wrangler(["d1", "migrations", "apply", "primearena", "--local", "--persist-to", persist]);
  check("migrações aplicadas no D1 local", mig.status === 0, mig.status === 0 ? "" : (mig.stderr || mig.stdout).slice(-300));
  if (mig.status !== 0) throw new Error("migrações");

  server = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT), "--persist-to", persist, "--log-level", "warn"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}/entrar`);
      if (r.status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  const home = await fetch(`${BASE}/`);
  check("página inicial responde 200 (lê o D1)", home.status === 200, String(home.status));
  const csp = home.headers.get("content-security-policy");
  check("cabeçalhos de segurança presentes", !!csp && home.headers.get("x-frame-options") === "DENY");
  for (const p of ["/torneios", "/jogos", "/entrar", "/cadastro", "/times"]) {
    const r = await fetch(`${BASE}${p}`, { redirect: "manual" });
    check(`GET ${p}`, r.status === 200 || r.status === 307, String(r.status));
  }
  const prot = await fetch(`${BASE}/admin`, { redirect: "manual" });
  check("/admin exige login", prot.status === 307 || prot.status === 302 || prot.status === 308, String(prot.status));
  const cron401 = await fetch(`${BASE}/api/cron/wallet`, { method: "POST" });
  check("cron sem segredo é recusado", cron401.status === 401, String(cron401.status));
  const cronOk = await fetch(`${BASE}/api/cron/wallet`, { method: "POST", headers: { authorization: "Bearer smoke-cron-secret-0123456789abcdef" } });
  check("cron com segredo roda (grava no D1)", cronOk.status === 200, String(cronOk.status));

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  const stamp = Date.now().toString(36);
  const email = `smoke${stamp}@exemplo.com`;
  const user = `smoke${stamp}`.slice(0, 20);
  const password = "Fumaca#Segura-2026";

  await page.goto(`${BASE}/cadastro`);
  await page.locator("#displayName").fill("Pessoa Fumaça");
  await page.locator("#username").fill(user);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator("#password2").fill(password);
  await page.locator('input[name="terms"]').check();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.waitForLoadState("networkidle");
  const afterSignup = page.url();
  check("cadastro cria a conta e entra", !afterSignup.includes("/cadastro") || (await page.getByText(/confirm/i).count()) > 0, afterSignup);

  // confirma o e-mail direto no banco (o link de verdade vai por e-mail)
  const upd = wrangler(["d1", "execute", "primearena", "--local", "--persist-to", persist, "--command", `UPDATE User SET emailVerifiedAt = ${Date.now()} WHERE email = '${email}'`]);
  check("e-mail marcado como confirmado (D1)", upd.status === 0);

  await page.context().clearCookies();
  await page.goto(`${BASE}/entrar`);
  await page.locator("#identifier").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForLoadState("networkidle");
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "pam_session");
  check("login funciona e cria cookie de sessão HttpOnly", !!session && session.httpOnly, session ? session.name : "sem cookie");
  await page.goto(`${BASE}/conta`);
  check("área da conta abre logado", page.url().includes("/conta") && (await page.getByText(/Pessoa Fuma/i).count()) > 0, page.url());

  const wrong = await browser.newPage();
  await wrong.goto(`${BASE}/entrar`);
  await wrong.locator("#identifier").fill(email);
  await wrong.locator("#password").fill("senha errada 123");
  await wrong.getByRole("button", { name: "Entrar" }).click();
  await wrong.waitForLoadState("networkidle");
  check("senha errada não entra", wrong.url().includes("/entrar"), wrong.url());

  await browser.close();
  if (/Error|error:/.test(serverLog.replace(/Request\.cf|undici|DOMException|Request was cancelled/g, ""))) {
    console.log("\n(avisos do servidor)\n" + serverLog.split("\n").filter((l) => /rror/.test(l) && !/Request\.cf|undici|cancelled|DOMException|processTicks/.test(l)).slice(0, 8).join("\n"));
  }
} catch (e) {
  check("execução do teste de fumaça", false, e instanceof Error ? e.message : String(e));
} finally {
  await stop();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
process.exit(failed.length ? 1 : 0);
