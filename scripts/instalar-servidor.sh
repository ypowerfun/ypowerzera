#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
#  Prime Arena: instalador para um servidor (VPS) NOVO com Ubuntu ou Debian.
#
#  Como usar (no servidor, como root, dentro da pasta do projeto):
#      bash scripts/instalar-servidor.sh        (se entrou com outro usuário:  sudo bash scripts/instalar-servidor.sh)
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
#  com o site no ar faria os CPFs cifrados deixarem de abrir). Para mudar uma resposta depois (domínio, SMTP...),
#  edite o .env (nano .env) e rode:  docker compose up -d
#
#  Sem perguntas (para automação), use variáveis de ambiente. Atenção: o que você digita na linha de comando fica
#  no histórico do terminal; para a senha do SMTP prefira responder à pergunta (a digitação não aparece na tela).
#      PA_DOMAIN=meusite.com.br PA_ADMIN_EMAIL=voce@exemplo.com PA_SMTP_URL='smtp://usuario:senha@servidor:587' \
#      PA_MAIL_FROM='Prime Arena <nao-responda@meusite.com.br>' PA_YES=1 sudo -E bash scripts/instalar-servidor.sh
#  Outras: PA_DIR (pasta do projeto), PA_DRY_RUN=1 (só cria o .env, não instala nem sobe nada), PA_IGNORE_DNS=1,
#          PA_SKIP_FIREWALL=1, PA_SKIP_SWAP=1, PA_FORCE_NEW_KEYS=1, PA_SSH_PORT (porta do SSH, se não for a 22), PA_NO_TTY=1, PA_SWAPFILE (padrão /swapfile), PA_FSTAB (padrão /etc/fstab).
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
have_tty() { [ "${PA_NO_TTY:-0}" = "1" ] && return 1; [ -t 0 ] && return 0; ( : </dev/tty ) 2>/dev/null; }

# pergunta (usa a variável de ambiente se já veio preenchida; sem terminal e sem valor, aborta)
ask() { # ask VAR "Pergunta" [padrão] [secreto]   (secreto=1: a digitação não aparece na tela)
  local var="$1" prompt="$2" def="${3:-}" secret="${4:-0}" cur="${!1:-}" ans=""
  if [ -n "$cur" ]; then return 0; fi
  if ! have_tty; then
    if [ -n "$def" ]; then printf -v "$var" '%s' "$def"; return 0; fi
    die "Falta ${var} e não há terminal para perguntar. Defina a variável de ambiente (veja --help)."
  fi
  if [ -n "$def" ]; then prompt="$prompt [$def]"; fi
  if [ "$secret" = "1" ]; then
    if [ -t 0 ]; then read -rs -p "$prompt: " ans; else read -rs -p "$prompt: " ans </dev/tty; fi
    printf '\n' >&2
  else
    if [ -t 0 ]; then read -r -p "$prompt: " ans; else read -r -p "$prompt: " ans </dev/tty; fi
  fi
  printf -v "$var" '%s' "${ans:-$def}"
}
confirm() { # confirm "Pergunta" [s|n]  (padrão da tecla Enter: s = sim, n = não). Sem terminal e sem PA_YES=1, a resposta é NÃO.
  if [ "$YES" = "1" ]; then return 0; fi
  local ans="" def="${2:-s}" hint="[S/n]"
  [ "$def" = "n" ] && hint="[s/N]"
  if ! have_tty; then warn "Sem terminal para perguntar; pulei: $1 (use PA_YES=1 para aceitar tudo)"; return 1; fi
  if [ -t 0 ]; then read -r -p "$1 $hint: " ans; else read -r -p "$1 $hint: " ans </dev/tty; fi
  case "${ans:-$def}" in s|S|sim|Sim|SIM|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

# primeiro caractere proibido (quebraria o arquivo de configuração) em um texto
bad_char() {
  local c
  for c in '$' '`' '"' "'" '\'; do case "$1" in *"$c"*) printf '%s' "$c"; return 0 ;; esac; done
  return 0
}
code_of() { case "$1" in '$') printf '%%24' ;; '`') printf '%%60' ;; '"') printf '%%22' ;; "'") printf '%%27' ;; '\') printf '%%5C' ;; esac; }

rand_hex() { if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"; else od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; fi; }
rand_b64() { if command -v openssl >/dev/null 2>&1; then openssl rand -base64 "$1" | tr -d '\n'; else head -c "$1" /dev/urandom | base64 | tr -d '\n'; fi; }

# apt que ESPERA o servidor recém-criado terminar as atualizações automáticas (que seguram o "lock" nos primeiros minutos)
apt_get() { DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 "$@"; }
# apt que ESPERA (até ~5 min) quando outro processo segura o lock; qualquer outro erro aparece na hora
apt_retry() {
  local i out rc=0
  for i in $(seq 1 30); do
    rc=0; out="$(apt_get "$@" 2>&1)" || rc=$?
    if [ "$rc" -eq 0 ]; then return 0; fi
    if printf '%s' "$out" | grep -Eqi 'Could not get lock|Unable to acquire the dpkg|dpkg frontend lock|is held by process'; then
      [ "$i" -eq 1 ] && warn "O servidor está terminando atualizações automáticas (comum em servidor recém-criado). Vou esperar e tentar de novo, por até uns 5 minutos…"
      sleep 10; continue
    fi
    printf '%s\n' "$out" >&2; return "$rc"
  done
  printf '%s\n' "$out" >&2; return 1
}

# valor de uma chave do .env, sem aspas
env_value() {
  local line v
  line="$(grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null || true)"
  line="${line%$'\r'}"                       # arquivo editado no Windows (fim de linha CRLF)
  v="${line#*=}"
  v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"   # espaços nas pontas
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"
  printf '%s' "$v"
}

# IP público deste servidor: guarda em SERVER_IP (chame SEM $( ), senão o valor se perde na subshell)
SERVER_IP=""
fetch_server_ip() {
  if [ -z "$SERVER_IP" ]; then
    SERVER_IP="$(curl -4fsS --max-time 8 https://api.ipify.org 2>/dev/null || curl -4fsS --max-time 8 https://ifconfig.me 2>/dev/null || true)"
  fi
}

# ─────────── 0) conferências iniciais ───────────
say "Prime Arena: instalador de servidor"
[ -f "$PA_DIR/docker-compose.yml" ] && [ -f "$PA_DIR/.env.production.example" ] || die "Não achei docker-compose.yml e .env.production.example em $PA_DIR. Rode o instalador de dentro da pasta do projeto (se baixou o zip pelo GitHub, entre antes na pasta extra que ele cria)."
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

# Quem entrou com outro usuário (ex.: ubuntu) e usou sudo precisa do sudo nos comandos seguintes (o .env é só do root)
SUDO=""
if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then SUDO="sudo "; fi

ENV_FILE="$PA_DIR/.env"
HAVE_ENV=0
if [ -f "$ENV_FILE" ]; then
  HAVE_ENV=1
  # Um .env que já existe é respeitado, mas precisa estar COMPLETO (pode ser o modelo sem preencher ou um .env de teste).
  missing=()
  for k in DOMAIN APP_URL APP_SECRET DATA_ENCRYPTION_KEY CRON_SECRET SMTP_URL MAIL_FROM ADMIN_EMAILS; do
    [ -n "$(env_value "$k")" ] || missing+=("$k")
  done
  v="$(env_value APP_SECRET)"
  if [ -n "$v" ] && { [ "${#v}" -lt 32 ] || [[ "$v" == *troque* ]] || [[ "$v" == *dev-only* ]]; }; then missing+=("APP_SECRET (fraco ou de exemplo)"); fi
  v="$(env_value CRON_SECRET)"
  if [ -n "$v" ] && [ "${#v}" -lt 24 ]; then missing+=("CRON_SECRET (curto demais)"); fi
  v="$(env_value APP_URL)"
  if [ -n "$v" ] && [[ "$v" != https://* ]]; then missing+=("APP_URL (precisa começar com https://)"); fi
  if [ "$(env_value DOMAIN)" = "meusite.com.br" ]; then missing+=("DOMAIN (ainda é o exemplo meusite.com.br)"); fi
  dom="$(env_value DOMAIN)"; url="$(env_value APP_URL)"
  if [ -n "$dom" ] && [ -n "$url" ] && [ "$url" != "https://$dom" ]; then missing+=("APP_URL (deveria ser https://$dom, igual ao DOMAIN)"); fi
  if [[ "$(env_value MAIL_FROM)" == *"@meusite.com.br"* ]]; then missing+=("MAIL_FROM (ainda é o exemplo @meusite.com.br)"); fi
  if [ "$(env_value ADMIN_EMAILS)" = "voce@exemplo.com" ]; then missing+=("ADMIN_EMAILS (ainda é o exemplo voce@exemplo.com)"); fi
  if [ "${#missing[@]}" -gt 0 ]; then
    die "O .env que já existe em $ENV_FILE não está pronto. Falta ou está inválido: ${missing[*]}. Se foi você quem o editou, complete esses itens (${SUDO}nano .env). Se é um modelo ou um .env de teste, renomeie-o (${SUDO}mv .env .env.antigo) e rode o instalador de novo."
  fi
  ok "Já existe um .env completo em $PA_DIR: os segredos NÃO serão trocados."
  say "Para mudar uma resposta (domínio, SMTP...), edite o .env (${SUDO}nano .env) e rode:  ${SUDO}docker compose up -d"
fi

# ─────────── 1) pacotes e Docker ───────────
if [ "$DRY" != "1" ]; then
  say "Preparando o servidor (se ele acabou de ser criado, pode levar alguns minutos esperando as atualizações automáticas)…"
  apt_retry -qq update || die "Não consegui atualizar a lista de pacotes do servidor (apt-get update). Veja a mensagem acima, confira se o servidor tem internet e rode de novo."
  if ! command -v curl >/dev/null 2>&1 || ! command -v unzip >/dev/null 2>&1; then
    apt_retry install -y curl unzip ca-certificates || die "Não consegui instalar curl/unzip. Rode de novo em alguns minutos."
  fi
  if ! command -v docker >/dev/null 2>&1; then
    say "Instalando o Docker (script oficial get.docker.com)…"
    curl -fsSL https://get.docker.com | sh || die "A instalação do Docker falhou. Veja a mensagem acima, confira a internet do servidor e rode de novo."
  fi
  if ! docker compose version >/dev/null 2>&1; then
    # Docker que já existia sem o "docker compose" (ex.: pacote docker.io do Ubuntu): tenta instalar o complemento
    apt_retry install -y docker-compose-plugin >/dev/null 2>&1 || apt_retry install -y docker-compose-v2 >/dev/null 2>&1 || true
  fi
  docker compose version >/dev/null 2>&1 || die "Este servidor já tinha o Docker, mas sem o comando 'docker compose'. Remova a versão antiga (apt-get remove -y docker.io) e rode o instalador de novo: ele instala a versão oficial completa."
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker info >/dev/null 2>&1 || die "O Docker está instalado, mas não está respondendo (o serviço não iniciou). Tente:  systemctl restart docker   e rode o instalador de novo."
  ok "Docker pronto: $(docker --version)"

  # Já existe um banco deste site neste servidor mas o .env sumiu: segredos novos tornariam os CPFs salvos ilegíveis.
  if [ "$HAVE_ENV" = "0" ] && [ "${PA_FORCE_NEW_KEYS:-0}" != "1" ]; then
    project="$(basename "$PA_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]//g; s/^[^a-z0-9]*//')"
    vols="$(docker volume ls -q --filter "label=com.docker.compose.project=${project}" --filter "label=com.docker.compose.volume=data" 2>/dev/null)" || die "Não consegui consultar os volumes do Docker (para saber se já existe um banco deste site). Rode de novo em instantes."
    vol="$(printf '%s\n' "$vols" | head -n1)"
    if [ -n "$vol" ]; then
      die "Já existe um banco de dados deste site neste servidor (volume '$vol'), mas não há .env nesta pasta. Gerar segredos NOVOS tornaria ilegíveis os CPFs já salvos e derrubaria todos os logins. Coloque aqui o .env que você guardou (cópia de segurança) e rode de novo. Se esse banco é só de teste e pode ser descartado, rode com PA_FORCE_NEW_KEYS=1 (os dados antigos continuarão no volume, mas os CPFs cifrados não abrirão)."
    fi
  fi

  # ─────────── 2) memória (a montagem do site precisa de ~2 GB) ───────────
  mem_kb="$(awk '/^MemTotal:/ {print $2}' "${PA_MEMINFO:-/proc/meminfo}")"
  swap_kb="$(awk '/^SwapTotal:/ {print $2}' "${PA_MEMINFO:-/proc/meminfo}")"
  if [ "${PA_SKIP_SWAP:-0}" != "1" ] && [ "${mem_kb:-0}" -lt 1800000 ] && [ "${swap_kb:-0}" -lt 1000000 ]; then
    warn "Este servidor tem pouca memória ($((mem_kb / 1024)) MB). A montagem do site pode falhar sem um arquivo de swap."
    if confirm "Criar 2 GB de swap agora?"; then
      swapfile="${PA_SWAPFILE:-/swapfile}"
      fstab="${PA_FSTAB:-/etc/fstab}"
      make_swap() {
        if [ ! -f "$swapfile" ]; then
          { fallocate -l 2G "$swapfile" 2>/dev/null || dd if=/dev/zero of="$swapfile" bs=1M count=2048 status=none; } || return 1
        fi
        chmod 600 "$swapfile" || return 1
        # arquivo de uma tentativa anterior que ficou pela metade: refaz e ativa
        if ! swapon --show=NAME --noheadings 2>/dev/null | grep -qxF "$swapfile"; then
          mkswap "$swapfile" >/dev/null && swapon "$swapfile" || return 1
        fi
        grep -qF "$swapfile " "$fstab" || echo "$swapfile none swap sw 0 0" >> "$fstab"
      }
      if make_swap; then ok "Swap de 2 GB criado."; else warn "Não consegui criar o swap (alguns servidores/containers não permitem). Sigo sem ele; se a montagem do site falhar por memória, use um servidor com 2 GB ou mais."; fi
    fi
  fi

  # ─────────── 3) firewall ───────────
  if [ "${PA_SKIP_FIREWALL:-0}" != "1" ]; then
    say "Firewall: só SSH, 80 e 443 ficam abertos."
    if confirm "Configurar o firewall (ufw) agora? (o seu acesso por SSH é mantido)"; then
      make_firewall() {
        command -v ufw >/dev/null 2>&1 || apt_retry install -y ufw || return 1
        ports=(22)
        # nunca se trancar para fora: libera a porta SSH desta conexão, a informada (PA_SSH_PORT) e as que o sshd usa
        if [ -n "${SSH_CONNECTION:-}" ]; then ports+=("$(awk '{print $4}' <<<"$SSH_CONNECTION")"); fi
        if [ -n "${PA_SSH_PORT:-}" ]; then ports+=("$PA_SSH_PORT"); fi
        if command -v sshd >/dev/null 2>&1; then while read -r p; do ports+=("$p"); done < <(sshd -T 2>/dev/null | awk '/^port / {print $2}'); fi
        if command -v ss >/dev/null 2>&1; then while read -r p; do ports+=("$p"); done < <(ss -ltnpH 2>/dev/null | awk '/"sshd"/ {n = split($4, a, ":"); print a[n]}'); fi
        opened=()
        while read -r p; do
          case "$p" in ''|*[!0-9]*) continue ;; esac
          ufw allow "$p/tcp" >/dev/null || return 1
          opened+=("$p")
        done < <(printf '%s\n' "${ports[@]}" | sort -un)
        ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ufw allow 443/udp >/dev/null && ufw --force enable >/dev/null || return 1
      }
      if make_firewall; then
        ok "Firewall ligado (portas abertas: ${opened[*]} 80 443)."
        warn "Se o painel do seu provedor de VPS tem um firewall próprio, libere 80 e 443 lá também."
      else
        warn "Não consegui configurar o firewall (ufw). O site funciona sem ele, mas proteja o servidor: libere só SSH, 80 e 443 no firewall do painel do seu provedor."
      fi
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
  ask PA_SMTP_URL "3/4 Endereço SMTP (ex.: smtp://usuario:senha@servidor:587; o que você digita não aparece na tela)" "" 1
  case "$PA_SMTP_URL" in
    *$'\n'*|*$'\r'*) die "O endereço SMTP não pode ter quebra de linha." ;;
  esac
  c="$(bad_char "$PA_SMTP_URL")"
  if [ -n "$c" ]; then
    die "O endereço SMTP tem o caractere  $c  que quebraria o arquivo de configuração. Troque esse caractere pelo código $(code_of "$c") (a tabela completa está em docs/CONFIGURAR_EMAIL.md, seção 4)."
  fi
  printf '%s' "$PA_SMTP_URL" | grep -Eq '^smtps?://([^/?#@[:space:]]+@)?[^/?#@:[:space:]]+(:[0-9]{1,5})?/?$' \
    || die "O endereço SMTP está mal formado. Ele deve ser como smtp://usuario:senha@servidor:587. Se o usuário ou a senha tiverem símbolos (@ : / # ? % e outros), troque cada um pelo código %XX (@ vira %40, / vira %2F, # vira %23, ? vira %3F, % vira %25). Tabela em docs/CONFIGURAR_EMAIL.md, seção 4."
  printf '%s' "$PA_SMTP_URL" | grep -Eq '%($|[^0-9A-Fa-f]|[0-9A-Fa-f]($|[^0-9A-Fa-f]))' \
    && die "O endereço SMTP tem um % solto. Um % só pode aparecer como código de dois dígitos (ex.: %40). Para escrever o próprio símbolo %, use %25."

  ask PA_MAIL_FROM "4/4 Remetente dos e-mails" "Prime Arena <nao-responda@${PA_DOMAIN}>"
  c="$(bad_char "$PA_MAIL_FROM")"
  [ -z "$c" ] || die "O remetente tem o caractere  $c  que não é permitido (use só letras, espaços, < > @ . - _)."
  case "$PA_MAIL_FROM" in *$'\n'*|*$'\r'*) die "O remetente não pode ter quebra de linha." ;; esac
  printf '%s' "$PA_MAIL_FROM" | grep -Eq '@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' || die "O remetente precisa ter um endereço de e-mail (ex.: Prime Arena <nao-responda@${PA_DOMAIN}>)."
  printf '%s' "$PA_MAIL_FROM" | grep -Eqi '@[^[:space:]>]*\.(local|invalid|test)[>[:space:]]*$' && die "O endereço do remetente não pode terminar em .local, .invalid ou .test: use um endereço do seu domínio."
fi

# ─────────── 5) o domínio já aponta para este servidor? ───────────
if [ "$HAVE_ENV" = "0" ] && [ "$DRY" != "1" ] && [ "${PA_IGNORE_DNS:-0}" != "1" ]; then
  say "Conferindo o DNS de $PA_DOMAIN…"
  fetch_server_ip
  server_ip="$SERVER_IP"
  # "|| true": domínio que ainda não existe no DNS faz o getent falhar; isso é justamente o caso a explicar, não a abortar em silêncio
  dns_ip="$(getent ahostsv4 "$PA_DOMAIN" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
  dns6="$(getent ahostsv6 "$PA_DOMAIN" 2>/dev/null | awk '{print $1}' | grep -v '^::ffff:' | sort -u | head -n3 | tr '\n' ' ' || true)"
  # registro IPv6 (AAAA) que NÃO é deste servidor: a Let's Encrypt valida por IPv6 primeiro e o certificado falha
  own6="$( (command -v ip >/dev/null 2>&1 && ip -6 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1) || true)"
  foreign6=""
  for a in $dns6; do grep -qxF "$a" <<<"$own6" || foreign6="$foreign6 $a"; done
  dns_ok=1
  if [ -z "$server_ip" ] || [ "$server_ip" != "$dns_ip" ]; then
    dns_ok=0
    warn "O domínio ${PA_DOMAIN} aponta para '${dns_ip:-nenhum endereço}', mas este servidor é '${server_ip:-desconhecido}'."
    warn "Crie/ajuste o registro A do domínio para ${server_ip:-o IP deste servidor}, espere propagar (minutos a horas) e rode este instalador de novo."
  fi
  if [ -n "$foreign6" ]; then
    dns_ok=0
    warn "O domínio tem registro IPv6 (AAAA) para outro lugar:${foreign6}. A Let's Encrypt tenta o IPv6 primeiro e o HTTPS não sai."
    warn "Apague o registro AAAA do domínio (ou aponte-o para este servidor) e rode de novo."
  fi
  if [ "$dns_ok" = "1" ]; then
    ok "O domínio aponta para este servidor ($server_ip)."
  else
    warn "Sem o DNS certo o HTTPS não sai (e tentativas falhas podem ser bloqueadas por um tempo pela Let's Encrypt). Usa Cloudflare? Deixe a nuvem CINZA (somente DNS)."
    [ "$YES" = "1" ] && die "Abortando (use PA_IGNORE_DNS=1 para continuar mesmo assim)."
    confirm "Continuar mesmo assim?" n || die "Instalação interrompida. Ajuste o DNS e rode de novo."
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
  printf '%s\n' "Para ver o conteúdo e copiá-lo para o seu gerenciador de senhas, rode no servidor:  ${SUDO}cat ${ENV_FILE}"
  if [ -z "$SUDO" ]; then
    printf '%s\n\n' "(ou, do seu computador:  scp root@${SERVER_IP:-IP_DO_SERVIDOR}:${ENV_FILE} ./env-primearena.txt)"
  else
    printf '\n'
  fi
fi

if [ "$DRY" = "1" ]; then
  ok "Modo de teste concluído: .env em $ENV_FILE (nada foi instalado nem iniciado)."
  exit 0
fi

# ─────────── 7) subir o site ───────────
domain="$(env_value DOMAIN)"
cd "$PA_DIR"

# As portas 80/443 precisam estar livres para o Caddy (HTTPS). Imagens com apache2/nginx já instalados são comuns.
if command -v ss >/dev/null 2>&1; then
  busy="$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v 'docker-proxy' || true)"
  if [ -n "$busy" ]; then
    names="$(printf '%s\n' "$busy" | grep -o 'users:(("[^"]*"' | cut -d'"' -f2 | sort -u | tr '\n' ' ' || true)"
    units=""
    for n in $names; do
      case "$n" in
        nginx) units="$units nginx" ;;
        apache2|httpd) units="$units apache2" ;;
        caddy) units="$units caddy" ;;
        *) units="$units $n" ;;
      esac
    done
    die "As portas 80/443 já estão em uso por: ${names:-outro programa}. O site precisa delas. Desligue-o e rode o instalador de novo:  ${SUDO}systemctl disable --now${units:- <programa>}   (se o nome não for de um serviço, encerre esse programa de outra forma)."
  fi
fi

say "Montando e iniciando o site (a primeira vez leva alguns minutos)…"
if ! docker compose up -d --build; then
  die "A montagem ou a inicialização falhou (veja a mensagem de erro acima). Causas comuns: pouca memória (aceite criar o swap), portas 80/443 ocupadas ou o servidor sem acesso à internet. Corrija e rode de novo: o instalador continua de onde parou."
fi

say "Esperando o site ficar de pé…"
healthy=0
for _ in $(seq 1 90); do
  if docker compose exec -T app curl -fsS -m 5 http://localhost:3000/entrar >/dev/null 2>&1; then healthy=1; break; fi
  sleep 5
done
if [ "$healthy" != "1" ]; then
  warn "O site não respondeu a tempo. Últimas linhas do registro (o motivo costuma estar aqui):"
  docker compose logs --tail=40 app || true
  die "Corrija o que o registro indica (geralmente o .env) e rode: ${SUDO}docker compose up -d"
fi
ok "O site está respondendo por dentro do servidor."

public=0
for _ in $(seq 1 36); do
  if curl -fsS -m 10 "https://${domain}/entrar" >/dev/null 2>&1; then public=1; break; fi
  sleep 5
done
if [ "$public" = "1" ]; then
  ok "https://${domain} está no ar com HTTPS."
  title="${G}${B}Pronto.${N}"
else
  warn "Ainda não abre em https://${domain}. Quase sempre é o DNS ainda propagando (ou um registro AAAA/IPv6 de outro lugar) ou as portas 80/443 fechadas no firewall do provedor."
  warn "Veja o certificado:  ${SUDO}docker compose logs --tail=50 caddy   (o Caddy continua tentando sozinho)"
  title="${Y}${B}Quase pronto:${N} o site está de pé no servidor, mas o endereço público ainda não abre."
fi

cat <<EOF

${title} Próximos passos (detalhes em docs/HOSPEDAGEM.md, seção 6):
  1. Abra https://${domain}/cadastro e crie a conta com o e-mail do administrador.
  2. Clique no link de confirmação que chegar por e-mail e crie a sua senha de administrador.
  3. Em Admin → Configurações, use "Enviar e-mail de teste para mim" e confira a "Verificação do site".
  4. Faça uma cópia do .env e dos backups para fora do servidor (docs/HOSPEDAGEM.md, seção 8).

Comandos úteis (nesta pasta):  ${SUDO}docker compose ps   |   ${SUDO}docker compose logs --tail=100 app   |   ${SUDO}docker compose up -d
EOF
