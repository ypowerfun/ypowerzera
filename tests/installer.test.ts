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
  const r = spawnSync("bash", [SCRIPT, ...args], { env: { PA_NO_TTY: "1", ...env } as unknown as NodeJS.ProcessEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const OK = {
  PA_DOMAIN: "arena.exemplo.com.br",
  PA_ADMIN_EMAIL: "Dono@Exemplo.com",
  PA_SMTP_URL: "smtp://usuario%40exemplo.com:s3nha%24forte@smtp.exemplo.com:587",
  PA_MAIL_FROM: "Prime Arena <nao-responda@arena.exemplo.com.br>",
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
      DOMAIN: "arena.exemplo.com.br",
      APP_URL: "https://arena.exemplo.com.br",
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
    ["domínio com https://", { PA_DOMAIN: "https://arena.exemplo.com.br" }, /Domínio inválido/],
    ["domínio com barra", { PA_DOMAIN: "arena.exemplo.com.br/" }, /Domínio inválido/],
    ["domínio sem ponto", { PA_DOMAIN: "localhost" }, /Domínio inválido/],
    ["e-mail do administrador inválido", { PA_ADMIN_EMAIL: "isso-nao-e-email" }, /E-mail inválido/],
    ["SMTP sem smtp://", { PA_SMTP_URL: "http://servidor:587" }, /smtp:\/\//],
    ["SMTP com cifrão (quebraria o arquivo)", { PA_SMTP_URL: "smtp://u:senha$x@servidor:587" }, /caractere  \$  que quebraria.*%24/],
    ["SMTP com aspas", { PA_SMTP_URL: 'smtp://u:se"nha@servidor:587' }, /caractere  "  que quebraria.*%22/],
    ["SMTP com crase", { PA_SMTP_URL: "smtp://u:se`nha@servidor:587" }, /caractere  `  que quebraria.*%60/],
    ["SMTP com # solto na senha (cortaria o endereço)", { PA_SMTP_URL: "smtp://u:se#nha@servidor:587" }, /mal formado.*%23/],
    ["SMTP com ? solto na senha", { PA_SMTP_URL: "smtp://u:se?nha@servidor:587" }, /mal formado.*%3F/],
    ["SMTP com / solto na senha", { PA_SMTP_URL: "smtp://u:se/nha@servidor:587" }, /mal formado.*%2F/],
    ["SMTP com @ solto na senha (dois @)", { PA_SMTP_URL: "smtp://u:se@nha@servidor:587" }, /mal formado.*%40/],
    ["SMTP com porta inválida", { PA_SMTP_URL: "smtp://u:p@servidor:abc" }, /mal formado/],
    ["SMTP com % solto", { PA_SMTP_URL: "smtp://u:50%@servidor:587" }, /% solto/],
    ["remetente sem e-mail", { PA_MAIL_FROM: "Prime Arena" }, /endereço de e-mail/],
    ["remetente @primearena.local", { PA_MAIL_FROM: "Prime Arena <no-reply@primearena.local>" }, /\.local/],
    ["remetente com cifrão", { PA_MAIL_FROM: "Prime $Arena <a@arena.exemplo.com.br>" }, /caractere  \$  que não é permitido/],
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
    expect(envOf(d).MAIL_FROM).toBe("Prime Arena <nao-responda@arena.exemplo.com.br>");
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
[ "$1" = "info" ] && [ "\${STUB_DOCKER_DOWN:-0}" = "1" ] && exit 1
if [ "$1" = "volume" ]; then
  [ "\${STUB_VOLUME_FAIL:-0}" = "1" ] && exit 1
  [ -n "\${STUB_VOLUME:-}" ] && echo "\$STUB_VOLUME"
fi
if [ "$1" = "compose" ]; then
  case "$2" in
    version) if [ "\${STUB_NOCOMPOSE:-0}" = "1" ] && [ ! -f "\$STUB_FLAGS/compose-installed" ]; then exit 1; fi; echo "Docker Compose version v9" ;;
    up) [ "\${STUB_UP:-ok}" = "ok" ] || { echo "Error response from daemon: simulated failure" >&2; exit 1; } ;;
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
    stub("getent", `if [ "$1" = "ahostsv6" ]; then [ -n "\${STUB_AAAA:-}" ] && echo "\$STUB_AAAA STREAM $2"; exit 0; fi
[ "\${STUB_DNS_FAIL:-0}" = "1" ] && exit 2
echo "\${STUB_DNS_IP:-203.0.113.5} STREAM $2"`);
    stub("ss", `case "$*" in
  *sport*) [ -n "\${STUB_BUSY:-}" ] && echo 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("'"\$STUB_BUSY"'",pid=812,fd=6))' ;;
  *) [ -n "\${STUB_SSHD_PORT:-}" ] && echo 'LISTEN 0 128 0.0.0.0:'"\$STUB_SSHD_PORT"' 0.0.0.0:* users:(("sshd",pid=700,fd=3))' ;;
esac
exit 0`);
    stub("id", `if [ "$1" = "-u" ]; then echo "\${STUB_UID:-0}"; else /usr/bin/id "$@"; fi`);
    stub("ufw", `echo "ufw $*" >> "$STUB_LOG"
[ "\${STUB_UFW_FAIL:-0}" = "1" ] && exit 1
exit 0`);
    stub("apt-get", `echo "apt-get $*" >> "$STUB_LOG"
case "$*" in *" update"*)
  [ "\${STUB_APT_FAIL:-0}" = "1" ] && exit 100
  if [ "\${STUB_APT_LOCK:-0}" -gt 0 ]; then
    n=$(cat "\$STUB_FLAGS/lock-count" 2>/dev/null || echo 0)
    if [ "$n" -lt "\$STUB_APT_LOCK" ]; then echo $((n + 1)) > "\$STUB_FLAGS/lock-count"; echo "E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 812" >&2; exit 100; fi
  fi ;; esac
case "$*" in *docker-compose-plugin*|*docker-compose-v2*) [ "\${STUB_APT_NOCOMPOSE:-0}" = "1" ] || : > "\$STUB_FLAGS/compose-installed" ;; esac
exit 0`);
    stub("systemctl", `echo "systemctl $*" >> "$STUB_LOG"`);
    stub("sshd", `echo "port 2200"`);
    stub("sleep", `exit 0`);
    // NENHUM teste pode mexer no sistema de quem o roda: swap e fstab apontam para arquivos temporários e estes comandos são simulados
    stub("fallocate", `echo "fallocate $*" >> "$STUB_LOG"; [ "\${STUB_SWAP_FAIL:-0}" = "1" ] && exit 1; : > "$3"`);
    stub("dd", `echo "dd $*" >> "$STUB_LOG"; exit 1`);
    stub("mkswap", `echo "mkswap $*" >> "$STUB_LOG"`);
    stub("swapon", `echo "swapon $*" >> "$STUB_LOG"`);
    const flags = path.join(d, "_flags");
    mkdirSync(flags);
    const swapfile = path.join(d, "fake-swapfile");
    const fstab = path.join(d, "fake-fstab");
    writeFileSync(fstab, "# fstab de teste\n");
    const osr = path.join(d, "os-release");
    writeFileSync(osr, 'ID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 24.04"\n');
    const mem = path.join(d, "meminfo");
    writeFileSync(mem, "MemTotal:       4000000 kB\nSwapTotal:            0 kB\n");
    const go = (env: Record<string, string> = {}) =>
      exec({
        PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: process.env.HOME ?? "", PA_DIR: d, PA_OS_RELEASE: osr, PA_MEMINFO: mem, STUB_LOG: log, STUB_FLAGS: flags, PA_SWAPFILE: swapfile, PA_FSTAB: fstab,
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
    expect(r.stdout).toMatch(/https:\/\/arena\.exemplo\.com\.br está no ar com HTTPS/);
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
    expect(r.stderr).toMatch(/Ainda não abre em https:\/\/arena\.exemplo\.com\.br/);
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

  // ───────── correções da revisão adversária ─────────
  it("DNS que ainda não existe: explica o problema em vez de abortar em silêncio", () => {
    const sb = sandbox();
    const r = sb.go({ PA_YES: "1", STUB_DNS_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/aponta para 'nenhum endereço'/);
    expect(r.stderr).toMatch(/Abortando \(use PA_IGNORE_DNS=1/);
    expect(existsSync(path.join(sb.d, ".env"))).toBe(false);
  });

  it("registro AAAA (IPv6) de outro lugar: avisa e não sobe (a Let's Encrypt validaria por IPv6)", () => {
    const sb = sandbox();
    const r = sb.go({ PA_YES: "1", STUB_AAAA: "2001:db8::99" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/registro IPv6 \(AAAA\).*2001:db8::99/);
    expect(sb.calls()).not.toContain("compose up");
  });

  it("portas 80/443 ocupadas por nginx/apache: explica antes de tentar subir", () => {
    const sb = sandbox();
    const r = sb.go({ PA_YES: "1", STUB_BUSY: "nginx" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/portas 80\/443 já estão em uso por: nginx/);
    expect(r.stderr).toMatch(/systemctl disable --now nginx\b/);
    expect(r.stderr).not.toMatch(/apache2/); // só o programa que realmente está nas portas
    expect(sb.calls()).not.toContain("compose up");
  });

  it("falha do docker compose up: mensagem em português com as causas comuns", () => {
    const r = sandbox().go({ PA_YES: "1", STUB_UP: "bad" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/A montagem ou a inicialização falhou/);
    expect(r.stderr).toMatch(/pouca memória/);
  });

  it("apt espera o lock das atualizações automáticas e uma falha do apt aborta com mensagem clara", () => {
    const ok = sandbox();
    expect(ok.go({ PA_YES: "1" }).status).toBe(0);
    expect(ok.calls()).toContain("DPkg::Lock::Timeout=300");
    const bad = sandbox().go({ PA_YES: "1", STUB_APT_FAIL: "1" });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/Não consegui atualizar a lista de pacotes/);
  });

  it("Docker já instalado sem 'docker compose': instala o complemento; se não der, explica o que fazer", () => {
    const sb = sandbox();
    const fixed = sb.go({ PA_YES: "1", STUB_NOCOMPOSE: "1" });
    expect(fixed.status, fixed.stderr).toBe(0);
    expect(sb.calls()).toMatch(/apt-get .*install -y docker-compose-plugin/);
    const stuck = sandbox().go({ PA_YES: "1", STUB_NOCOMPOSE: "1", STUB_APT_NOCOMPOSE: "1" });
    expect(stuck.status).not.toBe(0);
    expect(stuck.stderr).toMatch(/sem o comando 'docker compose'/);
    expect(stuck.stderr).toMatch(/apt-get remove -y docker\.io/);
  });

  it(".env que já existe mas está incompleto (modelo sem preencher): recusa, nomeia o que falta e não sobe", () => {
    const sb = sandbox();
    copyFileSync(path.join(sb.d, ".env.production.example"), path.join(sb.d, ".env"));
    const r = sb.go({ PA_YES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/não está pronto/);
    for (const k of ["APP_SECRET", "DATA_ENCRYPTION_KEY", "CRON_SECRET", "SMTP_URL", "ADMIN_EMAILS", "DOMAIN"]) expect(r.stderr, k).toContain(k); // inclui os exemplos não preenchidos
    expect(r.stderr).toMatch(/mv \.env \.env\.antigo/);
    expect(sb.calls()).not.toContain("compose up");
  });

  it(".env de desenvolvimento (segredo de exemplo, http://) também é recusado", () => {
    const sb = sandbox();
    writeFileSync(path.join(sb.d, ".env"), 'DOMAIN="x.com.br"\nAPP_URL="http://localhost:3000"\nAPP_SECRET="troque-esta-chave-em-producao-por-algo-bem-longo"\nDATA_ENCRYPTION_KEY="abc"\nCRON_SECRET="curto"\nSMTP_URL="smtp://u:p@h:587"\nMAIL_FROM="a <a@x.com.br>"\nADMIN_EMAILS="a@x.com.br"\n');
    const r = sb.go({ PA_YES: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/APP_SECRET \(fraco ou de exemplo\)/);
    expect(r.stderr).toMatch(/CRON_SECRET \(curto demais\)/);
    expect(r.stderr).toMatch(/APP_URL \(precisa começar com https:\/\/\)/);
    expect(r.stderr).not.toContain("troque-esta-chave"); // o valor do segredo nunca é impresso
  });

  it("banco deste site já existe no servidor mas o .env sumiu: NÃO gera segredos novos (os CPFs cifrados ficariam ilegíveis)", () => {
    const sb = sandbox();
    const bad = sb.go({ PA_YES: "1", STUB_VOLUME: "primearena_data" });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/Já existe um banco de dados deste site neste servidor/);
    expect(bad.stderr).toMatch(/CPFs já salvos/);
    expect(existsSync(path.join(sb.d, ".env"))).toBe(false);
    expect(sb.calls()).not.toContain("compose up");
    const forced = sb.go({ PA_YES: "1", STUB_VOLUME: "primearena_data", PA_FORCE_NEW_KEYS: "1" });
    expect(forced.status, forced.stderr).toBe(0);
    expect(existsSync(path.join(sb.d, ".env"))).toBe(true);
  });

  it("com .env presente o volume existente é o esperado: segue normalmente (atualização do site)", () => {
    const sb = sandbox();
    expect(sb.go({ PA_YES: "1" }).status).toBe(0);
    const again = sb.go({ PA_YES: "1", STUB_VOLUME: "primearena_data" });
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/edite o \.env \(nano \.env\)/);
  });

  it("'Pronto' só aparece quando o endereço público abre; senão diz 'Quase pronto'", () => {
    const good = sandbox().go({ PA_YES: "1" });
    expect(good.stdout).toMatch(/Pronto\./);
    expect(good.stdout).not.toMatch(/Quase pronto/);
    const pending = sandbox().go({ PA_YES: "1", STUB_PUBLIC: "bad" });
    expect(pending.status, pending.stderr).toBe(0);
    expect(pending.stdout).toMatch(/Quase pronto/);
    expect(pending.stdout).not.toMatch(/Pronto\./);
  });

  it("dica de cópia do .env e comandos seguintes funcionam para quem entrou com outro usuário (sudo) e para root", () => {
    const asUser = sandbox().go({ PA_YES: "1", SUDO_USER: "ubuntu" });
    expect(asUser.stdout).toMatch(/rode no servidor:  sudo cat .*\.env/);
    expect(asUser.stdout).not.toMatch(/scp /);
    expect(asUser.stdout).toMatch(/sudo docker compose ps/); // sem sudo o usuário comum não conseguiria
    const asRoot = sandbox().go({ PA_YES: "1" });
    expect(asRoot.stdout).toMatch(/rode no servidor:  cat .*\.env/);
    expect(asRoot.stdout).toMatch(/scp root@203\.0\.113\.5:.*\.env \.\/env-primearena\.txt/);
    expect(asRoot.stdout).not.toMatch(/sudo docker compose/);
  });

  it("remetente com 'test' ou 'local' no meio do domínio é aceito (só o final do endereço conta)", () => {
    for (const from of ["Prime Arena <nao-responda@app.test-arena.com.br>", "Prime Arena <a@loja.local.com.br>"]) {
      const d = workdir();
      const r = run(d, { ...OK, PA_MAIL_FROM: from });
      expect(r.status, `${from}: ${r.stderr}`).toBe(0);
      expect(envOf(d).MAIL_FROM).toBe(from);
    }
  });

  // ───────── correções da revisão adversária (2ª rodada) ─────────
  it("SMTP bem formado é aceito: senha com símbolos em código %XX, sem usuário, porta padrão", () => {
    for (const smtp of [
      "smtp://usuario%40exemplo.com:s%23nh%2Fa%3F%25@smtp.exemplo.com:587",
      "smtps://apikey:SG.abc-123_xyz@smtp.sendgrid.net:465",
      "smtp://localhost:25",
      "smtp://smtp.exemplo.com",
    ]) {
      const d = workdir();
      const r = run(d, { ...OK, PA_SMTP_URL: smtp });
      expect(r.status, `${smtp}: ${r.stderr}`).toBe(0);
      expect(envOf(d).SMTP_URL).toBe(smtp);
    }
  });

  it(".env editado no Windows (fim de linha CRLF) funciona e a verificação final usa o endereço certo", () => {
    const sb = sandbox();
    expect(sb.go({ PA_YES: "1" }).status).toBe(0);
    const envPath = path.join(sb.d, ".env");
    writeFileSync(envPath, readFileSync(envPath, "utf8").replace(/\n/g, "\r\n"));
    const r = sb.go({ PA_YES: "1" });
    expect(r.status, r.stderr).toBe(0);
    expect(sb.calls()).toContain("https://arena.exemplo.com.br/entrar");
    expect(sb.calls()).not.toMatch(/\r/);
  });

  it(".env existente com APP_URL diferente do DOMAIN ou remetente de exemplo é recusado", () => {
    const sb = sandbox();
    expect(sb.go({ PA_YES: "1" }).status).toBe(0);
    const envPath = path.join(sb.d, ".env");
    const good = readFileSync(envPath, "utf8");
    writeFileSync(envPath, good.replace(/^APP_URL=.*$/m, 'APP_URL="https://outro-dominio.com.br"'));
    const a = sb.go({ PA_YES: "1" });
    expect(a.status).not.toBe(0);
    expect(a.stderr).toMatch(/APP_URL \(deveria ser https:\/\/arena\.exemplo\.com\.br/);
    writeFileSync(envPath, good.replace(/^MAIL_FROM=.*$/m, 'MAIL_FROM="Prime Arena <nao-responda@meusite.com.br>"'));
    const b = sb.go({ PA_YES: "1" });
    expect(b.status).not.toBe(0);
    expect(b.stderr).toMatch(/MAIL_FROM \(ainda é o exemplo/);
  });

  it("servidor recém-criado com o apt ocupado: espera e segue; erro de apt de verdade aparece na hora", () => {
    const sb = sandbox();
    const r = sb.go({ PA_YES: "1", STUB_APT_LOCK: "2" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/terminando atualizações automáticas/);
    expect(sb.calls().match(/apt-get .*update/g)?.length).toBe(3); // 2 tentativas presas + 1 que passou
  });

  it("Docker instalado mas sem responder: para com instrução; consulta de volumes que falha também para (não gera chaves às cegas)", () => {
    const down = sandbox().go({ PA_YES: "1", STUB_DOCKER_DOWN: "1" });
    expect(down.status).not.toBe(0);
    expect(down.stderr).toMatch(/não está respondendo.*systemctl restart docker/);
    const sb = sandbox();
    const vol = sb.go({ PA_YES: "1", STUB_VOLUME_FAIL: "1" });
    expect(vol.status).not.toBe(0);
    expect(vol.stderr).toMatch(/Não consegui consultar os volumes do Docker/);
    expect(existsSync(path.join(sb.d, ".env"))).toBe(false);
  });

  it("swap e firewall que falham NÃO derrubam a instalação: avisam e seguem", () => {
    const sb = sandbox();
    writeFileSync(path.join(sb.d, "meminfo"), "MemTotal:       1000000 kB\nSwapTotal:            0 kB\n");
    const r = sb.go({ PA_YES: "1", STUB_SWAP_FAIL: "1", STUB_UFW_FAIL: "1" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/Não consegui criar o swap/);
    expect(r.stderr).toMatch(/Não consegui configurar o firewall/);
    expect(sb.calls()).toContain("docker compose up -d --build");
  });

  it("swap de uma tentativa anterior que ficou pela metade é refeito e ativado", () => {
    const sb = sandbox();
    writeFileSync(path.join(sb.d, "meminfo"), "MemTotal:       1000000 kB\nSwapTotal:            0 kB\n");
    writeFileSync(sb.swapfile, ""); // arquivo existe, mas nunca foi ativado
    const r = sb.go({ PA_YES: "1", PA_SKIP_FIREWALL: "1" });
    expect(r.status, r.stderr).toBe(0);
    expect(sb.calls()).toContain(`mkswap ${sb.swapfile}`);
    expect(sb.calls()).toContain(`swapon ${sb.swapfile}`);
  });

  it("firewall nunca tranca o SSH: porta informada (PA_SSH_PORT) e a do sshd lida do sistema também são liberadas antes de ligar", () => {
    const sb = sandbox();
    const r = sb.go({ PA_YES: "1", PA_SSH_PORT: "2222", STUB_SSHD_PORT: "2299", SSH_CONNECTION: "" });
    expect(r.status, r.stderr).toBe(0);
    const calls = sb.calls();
    for (const port of ["22", "2200", "2222", "2299"]) expect(calls, port).toContain(`ufw allow ${port}/tcp`);
    expect(calls.lastIndexOf("ufw allow 2299/tcp")).toBeLessThan(calls.indexOf("ufw --force enable"));
  });

  it("portas ocupadas por apache2: o comando sugerido é só do apache2", () => {
    const r = sandbox().go({ PA_YES: "1", STUB_BUSY: "apache2" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/systemctl disable --now apache2\b/);
    expect(r.stderr).not.toMatch(/nginx/);
  });
});

// ───────── Enter na pergunta de risco = NÃO (precisa de um terminal de verdade: usa pty via python3) ─────────
const hasPython = spawnSync("python3", ["--version"]).status === 0;
describe.skipIf(process.platform === "win32" || !hasPython)("instalador: perguntas com terminal de verdade (pty)", () => {
  const PTY = String.raw`
import os, pty, select, sys, time, json, re
cfg = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    os.execvpe("bash", ["bash", cfg["script"]], cfg["env"])
out = b""; t0 = time.time(); i = 0
while time.time() - t0 < 30:
    r, _, _ = select.select([fd], [], [], 0.3)
    if r:
        try: chunk = os.read(fd, 4096)
        except OSError: break
        if not chunk: break
        out += chunk
        last = out.decode("utf8", "replace").split("\n")[-1]
        if i < len(cfg["answers"]) and re.search(cfg["prompt"], last):
            os.write(fd, (cfg["answers"][i] + "\n").encode()); i += 1
    else:
        try:
            if os.waitpid(pid, os.WNOHANG)[0]: break
        except ChildProcessError: break
print(re.sub(r"\x1b\[[0-9;]*m", "", out.decode("utf8", "replace")))
`;
  function ptyRun(env: Record<string, string>, answers: string[], prompt: string) {
    const r = spawnSync("python3", ["-c", PTY, JSON.stringify({ script: SCRIPT, env, answers, prompt })], { encoding: "utf8" });
    return r.stdout;
  }

  it("Enter em 'Continuar mesmo assim?' (DNS errado) INTERROMPE a instalação; 's' continua", () => {
    const mk = () => {
      const d = workdir();
      const bin = path.join(d, "_bin");
      mkdirSync(bin);
      const stub = (n: string, body: string) => { writeFileSync(path.join(bin, n), `#!/bin/sh\n${body}\n`); chmodSync(path.join(bin, n), 0o755); };
      stub("docker", `[ "$1" = "--version" ] && echo "Docker version 99"; exit 0`);
      stub("curl", `for a in "$@"; do case "$a" in *ipify*|*ifconfig.me*) echo 203.0.113.5; exit 0;; esac; done; exit 0`);
      stub("getent", `[ "$1" = "ahostsv6" ] && exit 0; echo "192.0.2.77 STREAM $2"`);
      stub("id", `[ "$1" = "-u" ] && echo 0 || /usr/bin/id "$@"`);
      stub("apt-get", `exit 0`); stub("systemctl", `exit 0`); stub("sleep", `exit 0`); stub("ss", `exit 0`);
      const osr = path.join(d, "os-release"); writeFileSync(osr, "ID=ubuntu\n");
      const mem = path.join(d, "meminfo"); writeFileSync(mem, "MemTotal: 4000000 kB\nSwapTotal: 0 kB\n");
      const env = { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: process.env.HOME ?? "", TERM: "xterm", PA_DIR: d, PA_OS_RELEASE: osr, PA_MEMINFO: mem, PA_SKIP_FIREWALL: "1", PA_SKIP_SWAP: "1", ...OK };
      return { d, env };
    };
    const a = mk();
    const enter = ptyRun(a.env, [""], "Continuar mesmo assim\\? \\[s/N\\]: $");
    expect(enter).toContain("[s/N]"); // o padrão (Enter) é NÃO
    expect(enter).toMatch(/Instalação interrompida/);
    expect(existsSync(path.join(a.d, ".env"))).toBe(false);
    const b = mk();
    const yes = ptyRun(b.env, ["s"], "Continuar mesmo assim\\? \\[s/N\\]: $");
    expect(yes).not.toMatch(/Instalação interrompida/);
    expect(existsSync(path.join(b.d, ".env"))).toBe(true);
  });
});
