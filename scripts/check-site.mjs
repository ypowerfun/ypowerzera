// Confere o site JÁ NO AR: cabeçalhos de segurança, rotas que não podem estar abertas e arquivos que não podem vazar.
// Só faz requisições de leitura (GET/POST sem credencial); não cria conta nem altera nada.
//   npm run verificar-site -- https://meusite.com.br
// Sai com código 1 se algo importante falhar.
const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Uso: npm run verificar-site -- https://meusite.com.br");
  process.exit(1);
}
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);
const isHttps = base.startsWith("https://");

let failed = 0;
let warned = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const bad = (msg) => {
  failed++;
  console.log(`  ✖ ${msg}`);
};
const warn = (msg) => {
  warned++;
  console.log(`  ⚠ ${msg}`);
};

async function get(path, init = {}) {
  return fetch(base + path, { redirect: "manual", ...init });
}

console.log(`\nVerificando ${base}\n`);

// 1) o site responde
console.log("Site no ar");
try {
  const r = await get("/entrar");
  r.status === 200 ? ok("a página de entrada abre (200)") : bad(`/entrar respondeu ${r.status}`);

  console.log("\nCabeçalhos de segurança");
  const h = r.headers;
  if (isHttps) ok("o site usa HTTPS");
  else isLocal ? warn("endereço local sem HTTPS (normal só em teste): na internet use https://") : bad("o site está em http:// (sem HTTPS): senhas e sessões trafegam sem proteção");
  const csp = h.get("content-security-policy") ?? "";
  csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'") ? ok("Content-Security-Policy presente") : bad("Content-Security-Policy ausente ou incompleta");
  h.get("x-frame-options")?.toUpperCase() === "DENY" ? ok("X-Frame-Options: DENY (não pode ser embutido em outro site)") : bad("X-Frame-Options ausente");
  h.get("x-content-type-options")?.toLowerCase() === "nosniff" ? ok("X-Content-Type-Options: nosniff") : bad("X-Content-Type-Options ausente");
  h.get("referrer-policy") ? ok(`Referrer-Policy: ${h.get("referrer-policy")}`) : bad("Referrer-Policy ausente");
  if (isHttps) (h.get("strict-transport-security") ?? "").includes("max-age=") ? ok("Strict-Transport-Security (HSTS) presente") : bad("HSTS ausente");
  h.get("x-powered-by") ? bad(`X-Powered-By expõe a tecnologia (${h.get("x-powered-by")})`) : ok("sem X-Powered-By");
} catch (e) {
  bad(`não consegui acessar o site: ${e instanceof Error ? e.message : e}`);
  console.log("\nVerifique o endereço, o DNS e se o site está no ar (docker compose ps).\n");
  process.exit(1);
}

// 2) rotas que não podem estar abertas
console.log("\nÁreas protegidas");
for (const path of ["/admin", "/admin/kyc", "/admin/saques", "/admin/carteiras", "/admin/usuarios", "/carteira", "/conta"]) {
  const r = await get(path);
  const loc = r.headers.get("location") ?? "";
  r.status >= 300 && r.status < 400 && /\/entrar|\/$/.test(loc) ? ok(`${path} exige login`) : bad(`${path} respondeu ${r.status} sem login`);
}
{
  // navegação parcial (RSC) sem login não pode entregar dados do admin
  const tree = JSON.stringify(["", { children: ["admin", { children: ["__PAGE__", {}] }] }]);
  const r = await fetch(base + "/admin/carteiras", { headers: { RSC: "1", "Next-Router-State-Tree": tree } });
  const body = await r.text();
  /Saldo|balanceCents|Conciliar/i.test(body) && !/NEXT_REDIRECT/.test(body) ? bad("/admin/carteiras entregou dados do admin sem login (navegação parcial)") : ok("/admin não entrega dados nem por navegação parcial");
}

// 3) o que nunca pode ser servido
console.log("\nArquivos e rotas que não podem existir");
for (const path of ["/.env", "/.env.production", "/package.json", "/prisma/schema.prisma", "/prisma/dev.db", "/src/server/auth.ts", "/docker-compose.yml", "/Caddyfile", "/.git/config"]) {
  const r = await get(path);
  r.status === 404 ? ok(`${path} → 404`) : bad(`${path} respondeu ${r.status} (deveria ser 404)`);
}
{
  const r = await get("/dev/pix");
  r.status === 404 || (r.status >= 300 && r.status < 400) ? ok("/dev/pix (simulador de Pix) indisponível") : bad(`/dev/pix respondeu ${r.status}: o simulador não pode existir em produção`);
}

// 4) agendador e webhooks exigem segredo
console.log("\nAgendador e webhooks");
{
  const noSecret = await get("/api/cron/wallet", { method: "POST" });
  [401, 403, 404, 405].includes(noSecret.status) ? ok(`/api/cron/wallet sem segredo → ${noSecret.status}`) : bad(`/api/cron/wallet sem segredo respondeu ${noSecret.status}`);
  const wrong = await get("/api/cron/wallet", { method: "POST", headers: { Authorization: "Bearer segredo-errado-0123456789" } });
  [401, 403, 404].includes(wrong.status) ? ok(`/api/cron/wallet com segredo errado → ${wrong.status}`) : bad(`/api/cron/wallet com segredo errado respondeu ${wrong.status}`);
  for (const path of ["/api/webhooks/pix", "/api/webhooks/pix/transfer-authorization", "/api/webhooks/stripe"]) {
    const r = await get(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    // qualquer recusa serve (401/400 com a assinatura errada; 503 quando a carteira/provedor ainda não está configurado: falha fechada)
    r.status >= 400 ? ok(`${path} sem assinatura → ${r.status} (recusado)`) : bad(`${path} sem assinatura respondeu ${r.status} (deveria ser recusado)`);
  }
}

// 5) página inexistente não vaza detalhes
console.log("\nErros");
{
  const r = await get("/pagina-que-nao-existe-" + Date.now());
  const body = await r.text();
  r.status === 404 ? ok("página inexistente → 404") : bad(`página inexistente respondeu ${r.status}`);
  /at .*\.(ts|js):\d+|node_modules|Prisma|Error:/.test(body) ? bad("a página de erro mostra detalhes técnicos") : ok("a página de erro não mostra detalhes técnicos");
}

console.log(`\n${failed ? `✖ ${failed} verificação(ões) falharam` : "✔ Tudo certo"}${warned ? ` (${warned} aviso(s))` : ""}.\n`);
process.exit(failed ? 1 : 0);
