#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
#  Prime Arena: instalador para um servidor (VPS) NOVO com Ubuntu ou Debian.
#
#  Como usar (no servidor, como root, dentro da pasta do projeto):
#      sudo bash scripts/instalar-servidor.sh
#
#  O que ele faz, nesta ordem (e pede confirmação antes das partes que mexem no servidor):
#    1. confere o sistema e instala o que falta (curl, unzip, Docker);
#    2. cria um arquivo de "memória" (swap) se o servidor tiver pouca RAM;
#    3. libera só as portas necessárias no firewall (SSH, 80 e 443);
#    4. pergunta o domínio, o seu e-mail de administrador e o SMTP (e-mail de confirmação de conta);
#    5. confere se o domínio já aponta para este servidor;
#    6. cria o arquivo .env com segredos novos (nunca sobrescreve um .env que já existe);
#    7. sobe o site com HTTPS automático (docker compose up -d --build) e confere se ficou de pé.
#
#  Pode rodar de novo sem medo: se o .env já existe, os segredos NÃO são trocados (trocar a DATA_ENCRYPTION_KEY
#  com o site no ar faria os CPFs cifrados deixarem de abrir).
#
#  Sem perguntas (para automação), use variáveis de ambiente:
#      PA_DOMAIN=meusite.com.br PA_ADMIN_EMAIL=voce@exemplo.com PA_SMTP_URL='smtp://usuario:senha@servidor:587' \
#      PA_MAIL_FROM='Prime Arena <nao-responda@meusite.com.br>' PA_YES=1 sudo -E bash scripts/instalar-servidor.sh
#  Outras: PA_DIR (pasta do projeto), PA_DRY_RUN=1 (só cria o .env, não instala nem sobe nada), PA_IGNORE_DNS=1,
#          PA_SKIP_FIREWALL=1, PA_SKIP_SWAP=1, PA_SWAPFILE (padrão /swapfile), PA_FSTAB (padrão /etc/fstab).
# ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PA_DIR="${PA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DRY="${PA_DRY_RUN:-0}"
YES="${PA_YES:-0}"

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=""; G=""; Y=""; R=""; N=""; fi
say()  { printf '%s\n' "${B}==>${N} $*"; }
ok()   { printf '%s\n' "${G}✔${N} $*"; }
warn() { printf '%s\n' "${Y}⚠${N} $*" >&2; }
die()  { printf '%s\n' "${R}✖ $*${N}" >&2; exit 1; }

case "${1:-}" in
  -h|--help) awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}" | sed 's/^# \{0,2\}//'; exit 0 ;;
esac

# Existe um terminal para conversar com a pessoa? (/dev/tty pode existir como arquivo sem estar disponível de verdade)
have_tty() { [ -t 0 ] && return 0; ( : </dev/tty ) 2>/dev/null; }

# pergunta (usa a variável de ambiente se já veio preenchida; sem terminal e sem valor, aborta)
ask() { # ask VAR "Pergunta" [padrão]
  local var="$1" prompt="$2" def="${3:-}" cur="${!1:-}" ans=""
  if [ -n "$cur" ]; then return 0; fi
  if ! have_tty; then
    if [ -n "$def" ]; then printf -v "$var" '%s' "$def"; return 0; fi
    die "Falta ${var} e não há terminal para perguntar. Defina a variável de ambiente (veja --help)."
  fi
  if [ -n "$def" ]; then prompt="$prompt [$def]"; fi
  if [ -t 0 ]; then read -r -p "$prompt: " ans; else read -r -p "$prompt: " ans </dev/tty; fi
  printf -v "$var" '%s' "${ans:-$def}"
}
confirm() { # confirm "Pergunta" (padrão: sim). Sem terminal e sem PA_YES=1, a resposta é NÃO (nada arriscado roda sem pedir).
  if [ "$YES" = "1" ]; then return 0; fi
  local ans=""
  if ! have_tty; then warn "Sem terminal para perguntar; pulei: $1 (use PA_YES=1 para aceitar tudo)"; return 1; fi
  if [ -t 0 ]; then read -r -p "$1 [S/n]: " ans; else read -r -p "$1 [S/n]: " ans </dev/tty; fi
  case "${ans:-s}" in s|S|sim|Sim|SIM|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

rand_hex() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"; else od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; fi; }
rand_b64() { if command -v openssl >/dev/null 2>&1; then openssl rand -base64 "$1" | tr -d '\n'; else head -c "$1" /dev/urandom | base64 | tr -d '\n'; fi; }

# ─────────── 0) conferências iniciais ───────────
say "Prime Arena: instalador de servidor"
[ -f "$PA_DIR/docker-compose.yml" ] && [ -f "$PA_DIR/.env.production.example" ] || die "Não achei docker-compose.yml e .env.production.example em $PA_DIR. Rode o instalador de dentro da pasta do projeto."
if [ "$DRY" != "1" ]; then
  [ "$(id -u)" -eq 0 ] || die "Rode como administrador do servidor: sudo bash scripts/instalar-servidor.sh"
  # shellcheck disable=SC1090
  [ -r "${PA_OS_RELEASE:-/etc/os-release}" ] && . "${PA_OS_RELEASE:-/etc/os-release}" || true
  case "${ID:-}${ID_LIKE:-}" in
    *ubuntu*|*debian*) ;;
    *) die "Este instalador é para Ubuntu ou Debian (este servidor é: ${PRETTY_NAME:-desconhecido}). Use o passo a passo manual em docs/HOSPEDAGEM.md." ;;
  esac
  case "$(uname -m)" in x86_64|aarch64|arm64) ;; *) warn "Arquitetura $(uname -m) não testada." ;; esac
else
  warn "Modo de teste (PA_DRY_RUN=1): não instala nada e não sobe o site; só cria o .env."
fi

ENV_FILE="$PA_DIR/.env"
HAVE_ENV=0
if [ -f "$ENV_FILE" ]; then
  HAVE_ENV=1
  ok "Já existe um .env em $PA_DIR: os segredos NÃO serão trocados."
fi

# ─────────── 1) pacotes e Docker ───────────
if [ "$DRY" != "1" ]; then
  say "Instalando o que falta (curl, unzip, Docker)…"
  export DEBIAN_FRONTEND=noninteractive
  if ! command -v curl >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y curl unzip ca-certificates
  fi
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  fi
  docker compose version >/dev/null 2>&1 || die "O Docker foi instalado, mas o comando 'docker compose' não existe. Veja https://docs.docker.com/engine/install/"
  systemctl enable --now docker >/dev/null 2>&1 || true
  ok "Docker pronto: $(docker --version)"

  # ─────────── 2) memória (a montagem do site precisa de ~2 GB) ───────────
  mem_kb="$(awk '/^MemTotal:/ {print $2}' "${PA_MEMINFO:-/proc/meminfo}")"
  swap_kb="$(awk '/^SwapTotal:/ {print $2}' "${PA_MEMINFO:-/proc/meminfo}")"
  if [ "${PA_SKIP_SWAP:-0}" != "1" ] && [ "${mem_kb:-0}" -lt 1800000 ] && [ "${swap_kb:-0}" -lt 1000000 ]; then
    warn "Este servidor tem pouca memória ($((mem_kb / 1024)) MB). A montagem do site pode falhar sem um arquivo de swap."
    if confirm "Criar 2 GB de swap agora?"; then
      swapfile="${PA_SWAPFILE:-/swapfile}"
      fstab="${PA_FSTAB:-/etc/fstab}"
      if [ ! -f "$swapfile" ]; then
        fallocate -l 2G "$swapfile" 2>/dev/null || dd if=/dev/zero of="$swapfile" bs=1M count=2048 status=none
        chmod 600 "$swapfile" && mkswap "$swapfile" >/dev/null && swapon "$swapfile"
        grep -qF "$swapfile " "$fstab" || echo "$swapfile none swap sw 0 0" >> "$fstab"
        ok "Swap de 2 GB criado."
      fi
    fi
  fi

  # ─────────── 3) firewall ───────────
  if [ "${PA_SKIP_FIREWALL:-0}" != "1" ]; then
    say "Firewall: só SSH, 80 e 443 ficam abertos."
    if confirm "Configurar o firewall (ufw) agora? (o seu acesso por SSH é mantido)"; then
      command -v ufw >/dev/null 2>&1 || apt-get install -y ufw
      ports=(22)
      # nunca se trancar para fora: libera a porta SSH em uso por esta conexão e as configuradas no sshd
      if [ -n "${SSH_CONNECTION:-}" ]; then ports+=("$(awk '{print $4}' <<<"$SSH_CONNECTION")"); fi
      if command -v sshd >/dev/null 2>&1; then while read -r p; do ports+=("$p"); done < <(sshd -T 2>/dev/null | awk '/^port / {print $2}'); fi
      opened=()
      while read -r p; do
        case "$p" in ''|*[!0-9]*) continue ;; esac
        ufw allow "$p/tcp" >/dev/null
        opened+=("$p")
      done < <(printf '%s\n' "${ports[@]}" | sort -un)
      ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
      ufw --force enable >/dev/null
      ok "Firewall ligado (portas abertas: ${opened[*]} 80 443)."
      warn "Se o painel do seu provedor de VPS tem um firewall próprio, libere 80 e 443 lá também."
    fi
  fi
fi

# ─────────── 4) dados do site ───────────
if [ "$HAVE_ENV" = "0" ]; then
  say "Vou perguntar 4 coisas. (Dúvida em alguma? Veja docs/HOSPEDAGEM.md e docs/CONFIGURAR_EMAIL.md.)"
  ask PA_DOMAIN "1/4 Domínio do site, SEM https:// (ex.: meusite.com.br)"
  PA_DOMAIN="$(printf '%s' "$PA_DOMAIN" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  printf '%s' "$PA_DOMAIN" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' || die "Domínio inválido: '$PA_DOMAIN'. Use só o nome, como meusite.com.br (sem https://, sem barra, sem espaços)."

  ask PA_ADMIN_EMAIL "2/4 Seu e-mail (vira o ADMINISTRADOR do site)"
  PA_ADMIN_EMAIL="$(printf '%s' "$PA_ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  printf '%s' "$PA_ADMIN_EMAIL" | grep -Eq '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' || die "E-mail inválido: '$PA_ADMIN_EMAIL'."

  say "O site precisa enviar e-mails (confirmação de conta, recuperação de senha). Veja docs/CONFIGURAR_EMAIL.md para pegar o endereço SMTP."
  ask PA_SMTP_URL "3/4 Endereço SMTP (ex.: smtp://usuario:senha@servidor:587)"
  printf '%s' "$PA_SMTP_URL" | grep -Eq '^smtps?://[^[:space:]]+$' || die "O SMTP precisa começar com smtp:// ou smtps:// e não ter espaços."
  case "$PA_SMTP_URL" in
    *$'\n'*|*$'\r'*|*\$*|*\`*|*\"*|*\'*|*\\*) die "O endereço SMTP tem um caractere que quebraria o arquivo de configuração (\$ \` \" ' \\). Troque esse caractere pelo código %XX (ex.: \$ vira %24). Veja docs/CONFIGURAR_EMAIL.md." ;;
  esac

  ask PA_MAIL_FROM "4/4 Remetente dos e-mails" "Prime Arena <nao-responda@${PA_DOMAIN}>"
  case "$PA_MAIL_FROM" in
    *\$*|*\`*|*\"*|*\\*|*$'\n'*|*$'\r'*) die "O remetente tem caractere não permitido." ;;
  esac
  printf '%s' "$PA_MAIL_FROM" | grep -Eq '@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' || die "O remetente precisa ter um endereço de e-mail (ex.: Prime Arena <nao-responda@${PA_DOMAIN}>)."
  printf '%s' "$PA_MAIL_FROM" | grep -Eqi '@[^[:space:]>]*\.(local|invalid|test)[>[:space:]]*$' && die "O remetente não pode terminar em .local, .invalid ou .test: use um endereço do seu domínio."
fi

# ─────────── 5) o domínio já aponta para este servidor? ───────────
if [ "$HAVE_ENV" = "0" ] && [ "$DRY" != "1" ] && [ "${PA_IGNORE_DNS:-0}" != "1" ]; then
  say "Conferindo o DNS de $PA_DOMAIN…"
  server_ip="$(curl -4fsS --max-time 8 https://api.ipify.org 2>/dev/null || curl -4fsS --max-time 8 https://ifconfig.me 2>/dev/null || true)"
  dns_ip="$(getent ahostsv4 "$PA_DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}')"
  if [ -n "$server_ip" ] && [ "$server_ip" = "$dns_ip" ]; then
    ok "O domínio aponta para este servidor ($server_ip)."
  else
    warn "O domínio ${PA_DOMAIN} aponta para '${dns_ip:-nenhum endereço}', mas este servidor é '${server_ip:-desconhecido}'."
    warn "Sem o DNS certo o HTTPS não sai (e tentativas falhas podem ser bloqueadas por um tempo pela Let's Encrypt)."
    warn "Crie/ajuste o registro A do domínio para $server_ip, espere propagar e rode este instalador de novo."
    warn "Usa Cloudflare? Deixe a nuvem CINZA (somente DNS)."
    [ "$YES" = "1" ] && die "Abortando (use PA_IGNORE_DNS=1 para continuar mesmo assim)."
    confirm "Continuar mesmo assim?" || die "Instalação interrompida. Ajuste o DNS e rode de novo."
  fi
fi

# ─────────── 6) .env com segredos novos ───────────
if [ "$HAVE_ENV" = "0" ]; then
  say "Criando o arquivo .env com segredos novos…"
  PA_V_DOMAIN="$PA_DOMAIN"
  PA_V_APP_URL="https://$PA_DOMAIN"
  PA_V_APP_SECRET="$(rand_hex 32)"
  PA_V_DATA_ENCRYPTION_KEY="$(rand_b64 32)"
  PA_V_CRON_SECRET="$(rand_hex 24)"
  PA_V_ASAAS_WEBHOOK_TOKEN="$(rand_hex 24)"
  PA_V_ASAAS_TRANSFER_AUTH_TOKEN="$(rand_hex 24)"
  PA_V_ADMIN_EMAILS="$PA_ADMIN_EMAIL"
  PA_V_SMTP_URL="$PA_SMTP_URL"
  PA_V_MAIL_FROM="$PA_MAIL_FROM"
  # se o gerador de números aleatórios falhar, NÃO grava um .env com segredo vazio ou curto
  [ "${#PA_V_APP_SECRET}" -eq 64 ] && [ "${#PA_V_DATA_ENCRYPTION_KEY}" -eq 44 ] && [ "${#PA_V_CRON_SECRET}" -eq 48 ] \
    && [ "${#PA_V_ASAAS_WEBHOOK_TOKEN}" -eq 48 ] && [ "${#PA_V_ASAAS_TRANSFER_AUTH_TOKEN}" -eq 48 ] \
    || die "Não consegui gerar os segredos (openssl ou /dev/urandom indisponível). Nada foi gravado."
  export PA_V_DOMAIN PA_V_APP_URL PA_V_APP_SECRET PA_V_DATA_ENCRYPTION_KEY PA_V_CRON_SECRET PA_V_ASAAS_WEBHOOK_TOKEN \
    PA_V_ASAAS_TRANSFER_AUTH_TOKEN PA_V_ADMIN_EMAILS PA_V_SMTP_URL PA_V_MAIL_FROM
  tmp="$(mktemp "$PA_DIR/.env.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  chmod 600 "$tmp"
  awk '
    BEGIN {
      n = split("DOMAIN APP_URL APP_SECRET DATA_ENCRYPTION_KEY CRON_SECRET ADMIN_EMAILS SMTP_URL MAIL_FROM ASAAS_WEBHOOK_TOKEN ASAAS_TRANSFER_AUTH_TOKEN", keys, " ")
      for (i = 1; i <= n; i++) want[keys[i]] = 1
    }
    /^[A-Z_]+=/ {
      k = $0; sub(/=.*/, "", k)
      if (k in want) { printf "%s=\"%s\"\n", k, ENVIRON["PA_V_" k]; done[k]++; next }
    }
    { print }
    END { for (k in want) if (done[k] != 1) { print "ERRO: chave " k " não encontrada no modelo" > "/dev/stderr"; exit 1 } }
  ' "$PA_DIR/.env.production.example" > "$tmp" || die "Não consegui montar o .env a partir do modelo .env.production.example."
  mv "$tmp" "$ENV_FILE"
  trap - EXIT
  chmod 600 "$ENV_FILE"
  ok ".env criado (somente você lê: permissão 600)."
  printf '\n%s\n' "${Y}${B}GUARDE UMA CÓPIA DO .env FORA DESTE SERVIDOR.${N} Sem a DATA_ENCRYPTION_KEY que está nele, os CPFs cifrados não podem ser recuperados."
  printf '%s\n\n' "No seu computador:  scp root@IP_DO_SERVIDOR:$ENV_FILE ./env-primearena.txt   (e guarde num gerenciador de senhas)"
fi

if [ "$DRY" = "1" ]; then
  ok "Modo de teste concluído: .env em $ENV_FILE (nada foi instalado nem iniciado)."
  exit 0
fi

# ─────────── 7) subir o site ───────────
domain="$(awk -F'"' '/^DOMAIN=/ {print $2}' "$ENV_FILE")"
cd "$PA_DIR"
say "Montando e iniciando o site (a primeira vez leva alguns minutos)…"
docker compose up -d --build

say "Esperando o site ficar de pé…"
healthy=0
for _ in $(seq 1 90); do
  if docker compose exec -T app curl -fsS -m 5 http://localhost:3000/entrar >/dev/null 2>&1; then healthy=1; break; fi
  sleep 5
done
if [ "$healthy" != "1" ]; then
  warn "O site não respondeu a tempo. Últimas linhas do registro (o motivo costuma estar aqui):"
  docker compose logs --tail=40 app || true
  die "Corrija o que o registro indica (geralmente o .env) e rode: docker compose up -d"
fi
ok "O site está respondendo por dentro do servidor."

public=0
for _ in $(seq 1 36); do
  if curl -fsS -m 10 "https://${domain}/entrar" >/dev/null 2>&1; then public=1; break; fi
  sleep 5
done
if [ "$public" = "1" ]; then
  ok "https://${domain} está no ar com HTTPS."
else
  warn "Ainda não abre em https://${domain}. Quase sempre é o DNS ainda propagando ou as portas 80/443 fechadas no firewall do provedor."
  warn "Veja o certificado:  docker compose logs --tail=50 caddy"
fi

cat <<EOF

${G}${B}Pronto.${N} Próximos passos (detalhes em docs/HOSPEDAGEM.md, seção 6):
  1. Abra https://${domain}/cadastro e crie a conta com o e-mail do administrador.
  2. Clique no link de confirmação que chegar por e-mail e crie a sua senha de administrador.
  3. Em Admin → Configurações, use "Enviar e-mail de teste para mim" e confira a "Verificação do site".
  4. Faça uma cópia do .env e dos backups para fora do servidor (docs/HOSPEDAGEM.md, seção 8).

Comandos úteis (nesta pasta):  docker compose ps   |   docker compose logs --tail=100 app   |   docker compose up -d
EOF
