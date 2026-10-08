import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { assertProductionConfig } from "@/lib/env";

const ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "instalar-servidor.sh");
const dirs: string[] = [];

/** Roda o instalador com um ambiente limpo e sem terminal (stdin fechado). */
function exec(env: Record<string, string>, args: string[] = []) {
  const r = spawnSync("bash", [SCRIPT, ...args], { env: env as NodeJS.ProcessEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const OK = {
  PA_DOMAIN: "meusite.com.br",
  PA_ADMIN_EMAIL: "Dono@Exemplo.com",
  PA_SMTP_URL: "smtp://usuario%40exemplo.com:s3nha%24forte@smtp.exemplo.com:587",
  PA_MAIL_FROM: "Prime Arena <nao-responda@meusite.com.br>",
};

function workdir() {
  const d = mkdtempSync(path.join(tmpdir(), "pa-installer-"));
  dirs.push(d);
  copyFileSync(path.join(ROOT, "docker-compose.yml"), path.join(d, "docker-compose.yml"));
  copyFileSync(path.join(ROOT, ".env.production.example"), path.join(d, ".env.production.example"));
  return d;
}
function run(dir: string, env: Record<string, string> = {}) {
  return exec({ PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PA_DIR: dir, PA_DRY_RUN: "1", PA_YES: "1", ...env });
}
const envOf = (dir: string) => parseEnv(readFileSync(path.join(dir, ".env"), "utf8"));

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("instalador de servidor (scripts/instalar-servidor.sh)", () => {
  it("cria um .env completo e protegido, que passa na trava de configuração de produção do site", () => {
    const d = workdir();
    const r = run(d, OK);
    expect(r.status, r.stderr).toBe(0);
    expect(statSync(path.join(d, ".env")).mode & 0o777).toBe(0o600);
    const env = envOf(d);
    expect(env).toMatchObject({
      DOMAIN: "meusite.com.br",
      APP_URL: "https://meusite.com.br",
      ADMIN_EMAILS: "dono@exemplo.com",
      SMTP_URL: OK.PA_SMTP_URL,
      MAIL_FROM: OK.PA_MAIL_FROM,
      PAYMENTS_PROVIDER: "none",
      WALLET_ENABLED: "false",
      TRUST_PROXY: "true",
    });
    expect(env.APP_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(env.CRON_SECRET).toMatch(/^[0-9a-f]{48}$/);
    expect(Buffer.from(env.DATA_ENCRYPTION_KEY!, "base64")).toHaveLength(32);
    expect(env.ASAAS_WEBHOOK_TOKEN).not.toBe(env.ASAAS_TRANSFER_AUTH_TOKEN);

    // o site de verdade aceita este arquivo (NODE_ENV=production)
    const keys = [...Object.keys(env), "NODE_ENV"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      for (const [k, v] of Object.entries(env)) (process.env as Record<string, string>)[k] = v ?? "";
      (process.env as Record<string, string>).NODE_ENV = "production";
      expect(() => assertProductionConfig()).not.toThrow();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else (process.env as Record<string, string>)[k] = saved[k]!;
      }
    }
  });

  it("não deixa sobrar nenhum segredo do modelo em branco", () => {
    const d = workdir();
    expect(run(d, OK).status).toBe(0);
    const env = envOf(d);
    for (const k of ["APP_SECRET", "DATA_ENCRYPTION_KEY", "CRON_SECRET", "ADMIN_EMAILS", "SMTP_URL", "ASAAS_WEBHOOK_TOKEN", "ASAAS_TRANSFER_AUTH_TOKEN"]) expect(env[k], k).toBeTruthy();
    // as demais linhas do modelo continuam como estavam
    const model = parseEnv(readFileSync(path.join(d, ".env.production.example"), "utf8"));
    for (const k of ["PAYMENTS_PROVIDER", "WALLET_ENABLED", "PIX_REQUIRE_PAYER_DOC", "PAYOUTS_PAUSED", "TRUST_PROXY"]) expect(env[k]).toBe(model[k]);
  });

  it("rodar de novo NÃO troca os segredos (trocar a chave de criptografia perderia os CPFs)", () => {
    const d = workdir();
    expect(run(d, OK).status).toBe(0);
    const before = readFileSync(path.join(d, ".env"), "utf8");
    const again = run(d, { ...OK, PA_DOMAIN: "outro.com.br" });
    expect(again.status, again.stderr).toBe(0);
    expect(readFileSync(path.join(d, ".env"), "utf8")).toBe(before);
    expect(again.stdout).toMatch(/NÃO serão trocados/);
  });

  it("cada instalação gera segredos diferentes", () => {
    const a = workdir();
    const b = workdir();
    run(a, OK);
    run(b, OK);
    expect(envOf(a).APP_SECRET).not.toBe(envOf(b).APP_SECRET);
    expect(envOf(a).DATA_ENCRYPTION_KEY).not.toBe(envOf(b).DATA_ENCRYPTION_KEY);
  });

  it.each([
    ["domínio com https://", { PA_DOMAIN: "https://meusite.com.br" }, /Domínio inválido/],
    ["domínio com barra", { PA_DOMAIN: "meusite.com.br/" }, /Domínio inválido/],
    ["domínio sem ponto", { PA_DOMAIN: "localhost" }, /Domínio inválido/],
    ["e-mail do administrador inválido", { PA_ADMIN_EMAIL: "isso-nao-e-email" }, /E-mail inválido/],
    ["SMTP sem smtp://", { PA_SMTP_URL: "http://servidor:587" }, /smtp:\/\//],
    ["SMTP com cifrão (quebraria o arquivo)", { PA_SMTP_URL: "smtp://u:senha$x@servidor:587" }, /caractere que quebraria/],
    ["SMTP com aspas", { PA_SMTP_URL: 'smtp://u:se"nha@servidor:587' }, /caractere que quebraria/],
    ["SMTP com crase", { PA_SMTP_URL: "smtp://u:se`nha@servidor:587" }, /caractere que quebraria/],
    ["remetente sem e-mail", { PA_MAIL_FROM: "Prime Arena" }, /endereço de e-mail/],
    ["remetente @primearena.local", { PA_MAIL_FROM: "Prime Arena <no-reply@primearena.local>" }, /\.local/],
    ["remetente com cifrão", { PA_MAIL_FROM: "Prime $Arena <a@meusite.com.br>" }, /não permitido/],
  ])("recusa e não grava nada: %s", (_nome, over, msg) => {
    const d = workdir();
    const r = run(d, { ...OK, ...over });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(msg);
    expect(() => statSync(path.join(d, ".env"))).toThrow();
  });

  it("sem terminal e sem a variável, aborta em vez de travar esperando resposta", () => {
    const d = workdir();
    const r = run(d, { PA_DOMAIN: OK.PA_DOMAIN, PA_ADMIN_EMAIL: OK.PA_ADMIN_EMAIL });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/PA_SMTP_URL/);
  });

  it("remetente padrão usa o domínio informado", () => {
    const d = workdir();
    const { PA_MAIL_FROM: _ignorado, ...semRemetente } = OK;
    void _ignorado;
    const r = run(d, semRemetente);
    expect(r.status, r.stderr).toBe(0);
    expect(envOf(d).MAIL_FROM).toBe("Prime Arena <nao-responda@meusite.com.br>");
  });

  it("recusa rodar fora da pasta do projeto", () => {
    const d = mkdtempSync(path.join(tmpdir(), "pa-vazio-"));
    dirs.push(d);
    writeFileSync(path.join(d, "qualquer.txt"), "x");
    const r = run(d, OK);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/pasta do projeto/);
  });

  it("--help mostra o uso e não faz nada", () => {
    const r = exec({ PATH: process.env.PATH ?? "" }, ["--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/sudo bash scripts\/instalar-servidor\.sh/);
  });
});


// ───────── fluxo completo (sem Docker de verdade): comandos falsos no PATH registram o que o instalador tentaria fazer ─────────
describe.skipIf(process.platform === "win32")("instalador: fluxo completo com comandos simulados", () => {
  function sandbox() {
    const d = workdir();
    const bin = path.join(d, "_bin");
    mkdirSync(bin);
    const log = path.join(d, "_calls.log");
    writeFileSync(log, "");
    const stub = (name: string, body: string) => {
      writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(path.join(bin, name), 0o755);
    };
    stub("docker", `echo "docker $*" >> "$STUB_LOG"
[ "$1" = "--version" ] && echo "Docker version 99.0.0"
if [ "$1" = "compose" ]; then
  case "$2" in
    version) echo "Docker Compose version v9" ;;
    exec) [ "\${STUB_HEALTH:-ok}" = "ok" ] || exit 1 ;;
    logs) echo "app | linha simulada do registro" ;;
  esac
fi
exit 0`);
    stub("curl", `echo "curl $*" >> "$STUB_LOG"
for a in "$@"; do
  case "$a" in
    *ipify*|*ifconfig.me*) echo "\${STUB_SERVER_IP:-203.0.113.5}"; exit 0 ;;
    https://*/entrar) [ "\${STUB_PUBLIC:-ok}" = "ok" ] || exit 22; exit 0 ;;
  esac
done
exit 0`);
    stub("getent", `echo "\${STUB_DNS_IP:-203.0.113.5} STREAM $3"`);
    stub("id", `if [ "$1" = "-u" ]; then echo "\${STUB_UID:-0}"; else /usr/bin/id "$@"; fi`);
    stub("ufw", `echo "ufw $*" >> "$STUB_LOG"`);
    stub("apt-get", `echo "apt-get $*" >> "$STUB_LOG"`);
    stub("systemctl", `echo "systemctl $*" >> "$STUB_LOG"`);
    stub("sshd", `echo "port 2200"`);
    stub("sleep", `exit 0`);
    // NENHUM teste pode mexer no sistema de quem o roda: swap e fstab apontam para arquivos temporários e estes comandos são simulados
    stub("fallocate", `echo "fallocate $*" >> "$STUB_LOG"; : > "$3"`);
    stub("dd", `echo "dd $*" >> "$STUB_LOG"; exit 1`);
    stub("mkswap", `echo "mkswap $*" >> "$STUB_LOG"`);
    stub("swapon", `echo "swapon $*" >> "$STUB_LOG"`);
    const swapfile = path.join(d, "fake-swapfile");
    const fstab = path.join(d, "fake-fstab");
    writeFileSync(fstab, "# fstab de teste\n");
    const osr = path.join(d, "os-release");
    writeFileSync(osr, 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04"\n');
    const mem = path.join(d, "meminfo");
    writeFileSync(mem, "MemTotal:       4000000 kB\nSwapTotal:            0 kB\n");
    const go = (env: Record<string, string> = {}) =>
      exec({
        PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: process.env.HOME ?? "", PA_DIR: d, PA_OS_RELEASE: osr, PA_MEMINFO: mem, STUB_LOG: log, PA_SWAPFILE: swapfile, PA_FSTAB: fstab,
        SSH_CONNECTION: "198.51.100.9 50000 203.0.113.5 2200", ...OK, ...env,
      });
    return { d, go, swapfile, fstab, calls: () => readFileSync(log, "utf8") };
  }

  it("caminho feliz: firewall, .env, docker compose up e conferência do HTTPS", () => {
    const sb = sandbox();
    const r = sb.go({ PA_YES: "1" });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const calls = sb.calls();
    for (const c of ["ufw allow 2200/tcp", "ufw allow 80/tcp", "ufw allow 443/tcp", "ufw allow 443/udp", "ufw --force enable", "docker compose up -d --build"]) expect(calls, c).toContain(c);
    expect(calls.indexOf("ufw allow 2200/tcp")).toBeLessThan(calls.indexOf("ufw --force enable")); // libera o SSH ANTES de ligar o firewall
    expect(r.stdout).toMatch(/https:\/\/meusite\.com\.br está no ar com HTTPS/);
    expect(existsSync(path.join(sb.d, ".env"))).toBe(true);
  });

  it("DNS apontando para outro servidor: não sobe nada (evita bloqueio da Let's Encrypt); PA_IGNORE_DNS=1 libera", () => {
    const sb = sandbox();
    const bad = sb.go({ PA_YES: "1", STUB_DNS_IP: "192.0.2.77" });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/aponta para '192\.0\.2\.77'/);
    expect(sb.calls()).not.toContain("compose up");
    expect(existsSync(path.join(sb.d, ".env"))).toBe(false);
    const forced = sb.go({ PA_YES: "1", STUB_DNS_IP: "192.0.2.77", PA_IGNORE_DNS: "1" });
    expect(forced.status, forced.stderr).toBe(0);
    expect(sb.calls()).toContain("docker compose up -d --build");
  });

  it("site que não responde: mostra o registro, falha com mensagem clara e mantém o .env", () => {
    const sb = sandbox();
    const r = sb.go({ PA_YES: "1", STUB_HEALTH: "bad" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/não respondeu a tempo/);
    expect(r.stdout).toContain("linha simulada do registro");
    expect(existsSync(path.join(sb.d, ".env"))).toBe(true);
  });

  it("site de pé por dentro mas ainda sem HTTPS público: avisa (DNS/portas) sem falhar", () => {
    const sb = sandbox();
    const r = sb.go({ PA_YES: "1", STUB_PUBLIC: "bad" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/Ainda não abre em https:\/\/meusite\.com\.br/);
  });

  it("sem ser administrador do servidor: recusa", () => {
    const r = sandbox().go({ PA_YES: "1", STUB_UID: "1000" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Rode como administrador/);
  });

  it("sistema que não é Ubuntu/Debian: recusa e aponta o passo a passo manual", () => {
    const sb = sandbox();
    writeFileSync(path.join(sb.d, "os-release"), 'ID=fedora\nPRETTY_NAME="Fedora 40"\n');
    const r = sb.go({ PA_YES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Ubuntu ou Debian/);
    expect(r.stderr).toMatch(/HOSPEDAGEM\.md/);
  });

  it("segunda execução: não pergunta nada, não troca o .env e só garante que o site está de pé", () => {
    const sb = sandbox();
    expect(sb.go({ PA_YES: "1" }).status).toBe(0);
    const before = readFileSync(path.join(sb.d, ".env"), "utf8");
    const again = sb.go({ PA_YES: "1", PA_DOMAIN: "", PA_SMTP_URL: "", PA_ADMIN_EMAIL: "" });
    expect(again.status, again.stderr).toBe(0);
    expect(readFileSync(path.join(sb.d, ".env"), "utf8")).toBe(before);
    expect(again.stdout).toMatch(/NÃO serão trocados/);
  });

  it("sem terminal e sem PA_YES: pula o que mexe no servidor (firewall) e avisa", () => {
    const sb = sandbox();
    const r = sb.go({ PA_IGNORE_DNS: "1" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/Sem terminal para perguntar; pulei: Configurar o firewall/);
    expect(sb.calls()).not.toContain("ufw --force enable");
  });

  it("pouca memória: sem confirmação (sem terminal e sem PA_YES) avisa e NÃO cria o swap", () => {
    const sb = sandbox();
    writeFileSync(path.join(sb.d, "meminfo"), "MemTotal:       1000000 kB\nSwapTotal:            0 kB\n");
    const r = sb.go({ PA_SKIP_FIREWALL: "1", PA_IGNORE_DNS: "1" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/pouca memória/);
    expect(r.stderr).toMatch(/pulei: Criar 2 GB de swap/);
    expect(sb.calls()).not.toMatch(/mkswap|swapon|fallocate/);
    expect(existsSync(sb.swapfile)).toBe(false);
  });

  it("pouca memória: com confirmação cria o swap de 2 GB, ativa e registra no fstab (só nos caminhos de teste)", () => {
    const sb = sandbox();
    writeFileSync(path.join(sb.d, "meminfo"), "MemTotal:       1000000 kB\nSwapTotal:            0 kB\n");
    const r = sb.go({ PA_YES: "1", PA_SKIP_FIREWALL: "1" });
    expect(r.status, r.stderr).toBe(0);
    const calls = sb.calls();
    expect(calls).toContain(`fallocate -l 2G ${sb.swapfile}`);
    expect(calls).toContain(`mkswap ${sb.swapfile}`);
    expect(calls).toContain(`swapon ${sb.swapfile}`);
    expect(statSync(sb.swapfile).mode & 0o777).toBe(0o600);
    expect(readFileSync(sb.fstab, "utf8")).toContain(`${sb.swapfile} none swap sw 0 0`);
  });

  it("memória suficiente: não cria swap", () => {
    const sb = sandbox();
    const r = sb.go({ PA_YES: "1", PA_SKIP_FIREWALL: "1" });
    expect(r.status, r.stderr).toBe(0);
    expect(sb.calls()).not.toMatch(/mkswap|swapon|fallocate/);
  });
});
