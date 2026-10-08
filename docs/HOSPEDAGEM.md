# Como colocar o Prime Arena no ar (passo a passo)

Este guia leva você de **"tenho o .zip"** até **"o site está online com HTTPS"**. Não precisa saber programar; precisa copiar e colar comandos com atenção. Tempo estimado: 1 a 2 horas na primeira vez (a maior parte é esperar o DNS).

> **Em uma frase:** você aluga um servidor (VPS) com Linux, aponta o seu domínio para ele, copia o projeto, preenche um arquivo de configuração (`.env`) e roda **um comando** (`docker compose up -d --build`). O HTTPS, o agendador e o backup diário já vêm prontos.

---

## 0. Antes de começar: o que você precisa

| Item | Para quê | Observação |
|---|---|---|
| **Um domínio** (ex.: `meusite.com.br`) | Endereço do site e do HTTPS | Registro.br, GoDaddy, Hostinger… |
| **Um VPS Linux** (Ubuntu 22.04 ou 24.04) | Onde o site roda | Recomendo **2 GB de RAM** ou mais (a montagem do site consome memória). Com 1 GB, crie um arquivo de *swap*. |
| **Uma conta de envio de e-mail (SMTP)** | Confirmação de conta e recuperação de senha | Guia: [`CONFIGURAR_EMAIL.md`](CONFIGURAR_EMAIL.md) |
| **Um e-mail seu** | Vira o administrador do site | Vai em `ADMIN_EMAILS` |

**Não serve:** hospedagem compartilhada comum (cPanel/PHP). O site é um programa Node.js que precisa ficar rodando e ter um disco que persiste. Procure por **VPS** (Hetzner, DigitalOcean, Contabo, Hostinger VPS, Locaweb VPS, AWS Lightsail, etc.).

### Decisão importante: lançar em duas fases (recomendado)

| Fase | O que está ligado | O que precisa |
|---|---|---|
| **1. Campeonatos** | Contas, equipes, campeonatos gratuitos, organizações, painel admin. **Carteira e desafios desligados.** | Este guia + e-mail. |
| **2. Dinheiro (Pix)** | Carteira da equipe, depósitos, saques e desafios | [`CONFIGURAR_PIX.md`](CONFIGURAR_PIX.md): conta no provedor aprovada, testes no sandbox e **análise jurídica** (seção 1 daquele guia). |

O arquivo de configuração já vem na Fase 1 (`WALLET_ENABLED="false"`, `PAYMENTS_PROVIDER="none"`). Você liga a Fase 2 quando estiver pronto, sem reinstalar nada.

---

## Caminho rápido (recomendado): o instalador de um comando

Se o seu servidor é **Ubuntu ou Debian novo** (22.04, 24.04 ou Debian 12), este caminho faz as seções 2, 4 e 5 abaixo **sozinho**. Você só precisa de três coisas prontas:

1. o **servidor (VPS)** contratado, com o IP anotado e acesso por SSH;
2. o **DNS do domínio já apontando para o IP** do servidor (seção 1 abaixo; sem isso o HTTPS não sai);
3. o **endereço SMTP** do seu provedor de e-mail ([`CONFIGURAR_EMAIL.md`](CONFIGURAR_EMAIL.md), seções 2 a 4).

No **seu computador**, envie o zip (ajuste o nome e o IP):

```bash
scp prime-arena-1.0.zip root@IP_DO_SERVIDOR:/root/
```

No **servidor** (`ssh root@IP_DO_SERVIDOR`):

```bash
apt-get update && apt-get install -y unzip
mkdir -p /opt/primearena && cd /opt/primearena
unzip /root/prime-arena-1.0.zip
bash scripts/instalar-servidor.sh
```

O instalador instala o Docker, cria o arquivo de memória (swap) se faltar RAM, libera só as portas SSH/80/443 no firewall, **faz 4 perguntas** (domínio, o seu e-mail de administrador, o endereço SMTP, que você digita **sem ele aparecer na tela**, e o remetente dos e-mails), confere se o domínio já aponta para o servidor, gera os segredos, cria o `.env` e sobe o site com HTTPS. No fim mostra se `https://seudominio` já está no ar e os próximos passos.

- Se entrou no servidor com outro usuário (não `root`), coloque `sudo` na frente de cada comando do bloco acima (`sudo apt-get …`, `sudo mkdir …`, `sudo unzip …`) e rode o instalador com `sudo bash scripts/instalar-servidor.sh`. Depois do instalador, os comandos `docker compose …` também levam `sudo`.
- "Pasta do projeto" é a pasta onde ficam o `docker-compose.yml` e o `.env` (neste guia, `/opt/primearena`). Todos os comandos `docker compose …` precisam ser rodados dentro dela (`cd /opt/primearena`).
- Se baixou o zip pelo GitHub ("Download ZIP"), ele cria uma pasta extra dentro de `/opt/primearena`: entre nela (`cd /opt/primearena/ypowerzera-*`) antes de rodar o instalador e, neste guia, leia "`/opt/primearena`" como essa pasta. (O zip entregue pronto não tem essa pasta extra.)
- O instalador **para e explica** se: o DNS ainda não aponta para o servidor (ou há um registro IPv6/AAAA de outro lugar), as portas 80/443 já estão ocupadas por outro programa (apache2/nginx), o `.env` que já existe está incompleto, ou já existe um banco deste site no servidor mas o `.env` sumiu (nesse caso **restaure o `.env` guardado**: gerar chaves novas tornaria os CPFs salvos ilegíveis).
- **Rodar de novo é seguro: ele nunca troca os segredos de um `.env` completo.** Para **mudar uma resposta depois** (domínio, SMTP, remetente), edite o `.env` (`nano .env`) e rode `docker compose up -d`; se mudar o domínio, ajuste `DOMAIN` e `APP_URL` e o DNS.

Depois, siga a **seção 6** (criar o administrador), a **seção 7** (conferir a segurança) e a **seção 8** (backups). Se algo falhar, o instalador mostra o motivo; a seção 5 explica os sintomas mais comuns.

> O instalador foi testado com comandos simulados (a lógica de perguntas, validações, `.env`, firewall, DNS e espera pelo site). Ele **não pôde ser executado num servidor real com Docker** no ambiente onde o projeto foi desenvolvido; se algo se comportar diferente no seu servidor, as seções 2 a 5 abaixo fazem o mesmo passo a passo à mão.

### Pedir ajuda a uma IA (ChatGPT, Codex…) ou a um técnico, com segurança

- Nenhuma IA consegue **colocar o site no ar sozinha**: isso exige um servidor e o DNS do domínio, que só você tem. O que ela pode fazer é ajudar a **entender os passos e os erros**.
- **Nunca envie** a uma IA ou a um desconhecido: a senha do servidor, o login do seu registro de domínio ou do provedor de e-mail, o arquivo `.env`, chaves de API (Asaas, Stripe) ou a `DATA_ENCRYPTION_KEY`. Quem tem o `.env` controla o site e os CPFs dos usuários.
- **Pode enviar** (depois de dar uma olhada): mensagens de erro, a saída de `docker compose logs --tail=100 app` e prints sem dados pessoais.
- Se contratar um técnico, dê acesso por um **usuário/chave temporários** e remova ao final; depois **troque as senhas** que ele chegou a ver.
- Se uma ferramenta de IA falha **antes de abrir o arquivo** (por exemplo, "setup refresh had errors" no Codex), o problema é do ambiente dela, não do projeto: tente outro chat ou ferramenta, ou siga este guia direto no servidor.

---

## 1. Aponte o domínio para o servidor

1. Contrate o VPS e anote o **IP público** dele (ex.: `203.0.113.10`).
2. No painel onde o domínio foi comprado, abra **DNS** e crie:
   - registro **A**: nome `@` (ou o próprio domínio) → o IP do VPS
   - **não crie** o registro `www`: o site responde só no endereço exato do domínio (sem `www`) e um `www` apontado para o servidor daria erro de certificado. Se quiser o `www`, faça-o redirecionar para o domínio no painel do seu registro de domínio.
3. **Cloudflare:** se usar, deixe a nuvem **cinza ("somente DNS")**. Com a nuvem laranja (proxy) todos os visitantes aparecem com o IP da Cloudflare e os limites anti-abuso por IP passam a valer para todo mundo junto.
4. Espere o DNS propagar (de minutos a poucas horas). Teste: `ping meusite.com.br` deve mostrar o IP do VPS.

> O certificado HTTPS é emitido sozinho na primeira visita, **mas só se o DNS já estiver certo e as portas 80 e 443 estiverem abertas**. Por isso faça este passo antes do passo 5.

---

## 2. Prepare o servidor (uma vez só)

Conecte por SSH (no Windows 10/11, o PowerShell já tem `ssh`):

```bash
ssh root@IP_DO_SEU_VPS
```

Instale o Docker (script oficial) e o `unzip`:

```bash
apt-get update && apt-get install -y unzip curl
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version     # os dois devem mostrar uma versão
```

Libere só o necessário no firewall (Ubuntu):

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable
```

Boas práticas que valem ouro: use **chave SSH** em vez de senha, desative o login por senha (`PasswordAuthentication no` em `/etc/ssh/sshd_config`), e deixe as atualizações automáticas de segurança ligadas (`apt-get install -y unattended-upgrades`). A porta 3000 do site **não** é aberta ao mundo: só o Caddy (80/443) conversa com a internet.

---

## 3. Envie o projeto para o servidor

No **seu computador**, na pasta onde está o `.zip` (ajuste o nome do arquivo):

```bash
scp prime-arena-1.0.zip root@IP_DO_SEU_VPS:/root/
```

(No Windows você também pode usar o WinSCP ou o FileZilla, protocolo SFTP.)

No **servidor**:

```bash
mkdir -p /opt/primearena && cd /opt/primearena
unzip /root/prime-arena-1.0.zip
ls          # deve listar: Dockerfile  docker-compose.yml  Caddyfile  package.json  src  prisma  ...
```

---

## 4. Preencha o arquivo de configuração (`.env`)

```bash
cd /opt/primearena
cp .env.production.example .env
chmod 600 .env          # só o dono lê (ele guarda as senhas)
```

### 4.1 Gere os segredos

No seu computador com Node instalado: `npm run secrets`. No servidor, sem Node:

```bash
cd /opt/primearena
docker run --rm -v "$PWD/scripts:/s:ro" node:22-bookworm-slim node /s/gen-secrets.mjs
```

Ele imprime `APP_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET` e os tokens do Pix. Cole as linhas no `.env` (substitua as vazias) e **guarde uma cópia fora do servidor** (gerenciador de senhas).

> 🔐 **`DATA_ENCRYPTION_KEY` é a mais importante.** Ela cifra o CPF dos usuários. Se você perdê-la ou trocá-la depois de o site estar no ar, **os CPFs já salvos não abrem mais**. Nunca rode o gerador de novo para "renovar" essa chave.

### 4.2 Edite o `.env` (use `nano .env`; salvar: `Ctrl+O`, `Enter`; sair: `Ctrl+X`)

Preencha no mínimo:

| Variável | O que colocar |
|---|---|
| `DOMAIN` | `meusite.com.br` (sem `https://`) |
| `APP_URL` | `https://meusite.com.br` (com `https://`) |
| `APP_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET` | os valores do passo 4.1 |
| `ADMIN_EMAILS` | o seu e-mail (quem vira administrador) |
| `SMTP_URL`, `MAIL_FROM` | veja [`CONFIGURAR_EMAIL.md`](CONFIGURAR_EMAIL.md) |

Deixe como está na Fase 1: `TRUST_PROXY="true"`, `PAYMENTS_PROVIDER="none"`, `WALLET_ENABLED="false"`.

**Se algo estiver faltando ou errado, o site se recusa a subir** e diz exatamente o quê (veja `docker compose logs app`). Isso é de propósito: melhor não subir do que subir inseguro.

---

## 5. Suba o site

```bash
cd /opt/primearena
docker compose up -d --build
```

A primeira vez demora alguns minutos (baixa imagens e monta o site). Depois:

```bash
docker compose ps                 # app, caddy, cron e backup devem estar "running" (o app fica "healthy")
docker compose logs -f app        # acompanha o site subindo (Ctrl+C sai; o site continua)
```

Abra `https://meusite.com.br`. Se aparecer o site com o cadeado, deu certo.

**Não abriu?** Veja:
- Se todas as páginas mostram **"Internal Server Error"** (erro 500) e `docker compose ps` marca o `app` como **unhealthy**, é a **trava de segurança** do site: ele não serve nada enquanto a configuração estiver insegura ou incompleta. Rode `docker compose logs app`: ele lista exatamente o que falta ou está errado no `.env` (ou avisa que o banco tem as contas de demonstração, que têm senha pública). Corrija e rode `docker compose up -d`.
- `docker compose logs caddy`: problemas de certificado (quase sempre DNS ainda não propagou ou porta 80/443 fechada no firewall do provedor do VPS).
- Muitos VPS têm **um firewall no painel do provedor** além do `ufw`: libere 80 e 443 lá também.

---

## 6. Crie o administrador

1. Acesse `https://meusite.com.br/cadastro` e crie a conta **com o mesmo e-mail que você colocou em `ADMIN_EMAILS`**. Faça isso **logo depois de subir o site**, antes de divulgar o endereço.
2. Abra o e-mail de confirmação que chegou e clique no link. **O cargo de administrador só vale depois de o e-mail confirmado.**
3. Como é o e-mail de administrador, o site pede para **criar a senha agora** (a que você digitou no cadastro é descartada). Isso garante que só quem lê aquela caixa de entrada vira administrador, mesmo que alguém tenha se cadastrado com o seu e-mail antes de você. Crie a senha, entre e pronto: aparece o menu **Admin**. Nada de senha padrão: não existe conta de administrador pré-criada.
   - *Se a página disser só "e-mail confirmado" e a sua senha do cadastro não funcionar* (alguns leitores de e-mail abrem o link antes de você), use **Esqueci minha senha** na tela de entrada: o link chega no mesmo e-mail e você cria a senha.
4. Em **Admin → Usuários** você promove organizadores e também pode **suspender uma conta** (golpe, trapaça, assédio): a pessoa é desconectada na hora e não consegue mais entrar; dá para reativar depois. Tudo fica registrado. Em **Admin → Configurações** fica a **"Verificação do site"** (um checklist: endereço, e-mail, agendador, pagamentos, segredos, proxy) e o botão **"Enviar e-mail de teste para mim"**.

Se o e-mail não chegou: [`CONFIGURAR_EMAIL.md`](CONFIGURAR_EMAIL.md), seção 7.

---

## 7. Confira a segurança do site no ar

Do **seu computador** (precisa do Node):

```bash
npm run verificar-site -- https://meusite.com.br
```

Ou, sem Node, do servidor (dentro de `/opt/primearena`): `docker run --rm -v "$PWD/scripts:/s:ro" node:22-bookworm-slim node /s/check-site.mjs https://meusite.com.br`

Ele só faz leituras e confere: HTTPS e cabeçalhos de segurança, que as áreas `/admin`, `/carteira` e `/conta` exigem login, que arquivos como `.env`, `package.json` e o código não são servidos, que o simulador de Pix não existe, que o agendador e os webhooks recusam quem não tem o segredo e que erros não mostram detalhes técnicos. Tudo precisa estar ✔.

---

## 8. Backups (não pule)

O banco é um arquivo SQLite dentro de um volume do Docker. **O `docker-compose.yml` já faz uma cópia consistente por dia** (a primeira 5 minutos após subir) e guarda as **14 mais recentes**. Mas elas ficam **no mesmo servidor**: se o servidor sumir, somem juntas. Por isso copie para fora:

```bash
# no servidor, uma cópia de todos os backups para uma pasta:
cd /opt/primearena && docker compose cp backup:/data/backups ./backups-do-servidor
# no SEU computador, baixe essa pasta:
scp -r root@IP_DO_SEU_VPS:/opt/primearena/backups-do-servidor ./
```

Faça isso toda semana (ou ative os *snapshots* automáticos do seu provedor de VPS, que também ajudam). **Guarde junto o `.env`**, principalmente a `DATA_ENCRYPTION_KEY`: o backup sem ela não abre os CPFs.

### Restaurar um backup
```bash
cd /opt/primearena
docker compose stop app cron backup
docker compose run --rm --no-deps --entrypoint sh app -c "cp /data/backups/primearena-AAAAMMDD-HHMM.db /data/primearena.db"
docker compose up -d
```
(troque `AAAAMMDD-HHMM` pelo nome do arquivo; `docker compose run --rm --no-deps --entrypoint ls app /data/backups` lista os disponíveis.) Para restaurar um arquivo que você baixou, copie-o antes para o volume com `docker compose cp ./arquivo.db backup:/data/backups/` e use o nome dele no comando acima.

> ⚠️ **Nunca rode `docker compose down -v`** (ou `docker volume rm`): o `-v` apaga o volume, ou seja, **o banco inteiro e os backups**. Para parar o site use `docker compose stop`; para recriar use `docker compose up -d`.

---

## 9. Atualizar o site depois

Quando receber uma versão nova (.zip):

```bash
cd /opt/primearena
cp .env /root/env-backup             # por precaução
unzip -o /root/prime-arena-NOVO.zip  # sobrescreve o código; o .env e o banco não estão no zip
docker compose up -d --build
```

O banco fica no volume e **não é apagado**: ao subir, o site só cria/atualiza tabelas (`prisma db push` sem `--force-reset`; se uma mudança exigisse apagar dados, ele **recusa** e o erro aparece nos logs). Faça um backup antes (`docker compose exec backup node scripts/backup-db.mjs`).

---

## 10. Dia a dia

| Quero… | Comando (em `/opt/primearena`) |
|---|---|
| Ver se tudo está de pé | `docker compose ps` |
| Ver os erros do site | `docker compose logs --tail=200 app` |
| Ver se os e-mails falham | `docker compose logs app \| grep "\[mail\]"` |
| Reiniciar | `docker compose restart app` |
| Aplicar mudança no `.env` | `docker compose up -d` |
| Parar tudo (sem apagar nada) | `docker compose stop` |
| Fazer um backup agora | `docker compose exec backup node scripts/backup-db.mjs` |
| **Suspender todos os saques** (emergência) | no `.env`: `PAYOUTS_PAUSED="true"` e `docker compose up -d` |
| Desligar a carteira inteira | **Admin → Configurações** (chave da carteira), sem mexer em arquivo |

O **agendador** (serviço `cron`) chama o site a cada 2 minutos (envia saques aprovados, expira Pix e desafios, concilia o razão). Em **Admin → Configurações → Verificação do site**, o item "Agendador" fica vermelho se ele parou de rodar há mais de 15 minutos. Na Fase 1 (carteira desligada) ele roda sem nada a fazer.

---

## 11. Ligar o dinheiro (Fase 2)

Só depois do site estável, do e-mail funcionando e do **sandbox do Asaas testado**: siga [`CONFIGURAR_PIX.md`](CONFIGURAR_PIX.md) (contas, tokens, webhooks na URL real `https://meusite.com.br/api/webhooks/...`, testes com valor de centavos). Resumo: preencher as variáveis do Asaas no `.env`, trocar `WALLET_ENABLED="true"` e rodar `docker compose up -d`. Comece em `ASAAS_ENV="sandbox"` e só depois passe para `production`.

---

## 12. Rodar sem Docker (avançado)

Possível em qualquer Linux com **Node 22.13 ou mais novo**:

```bash
npm ci
npm run build
npx prisma db push                       # cria as tabelas (sem apagar dados)
NODE_ENV=production npm start            # escuta na porta 3000, com todas as variáveis do .env exportadas
```
Aí você precisa de: um **proxy com HTTPS** na frente (Caddy ou Nginx) que escreva o IP real em `X-Forwarded-For`; algo que **reinicie** o processo se ele cair (systemd/pm2); um **agendador** que faça `POST /api/cron/wallet` com `Authorization: Bearer $CRON_SECRET` a cada 2 minutos; e **backup** (`npm run backup`, rodando 1x/dia). O `docker-compose.yml` já resolve tudo isso, por isso é o caminho recomendado.

---

## 13. Limites e avisos honestos

- **Um servidor só.** O projeto foi desenhado e testado para **uma** instância com SQLite. Não rode duas cópias do site no mesmo banco, nem em balanceador de carga. Para o tamanho de um site de campeonatos de comunidade isso aguenta bem; se um dia precisar escalar, será necessário migrar para Postgres (trabalho de engenharia e novos testes).
- **O pacote Docker não foi construído no ambiente onde o projeto foi desenvolvido** (o ambiente não tem Docker). Os mesmos passos (instalar, montar, criar o banco, subir em modo produção) foram executados e testados sem Docker, mas o primeiro `docker compose up -d --build` no seu servidor é a primeira vez que a imagem é montada. Se algo falhar nele, o erro aparece na tela do build e costuma ser de rede ou de memória do servidor.
- **Pix/Asaas:** o adaptador foi escrito pela documentação pública e **nunca foi validado contra o sandbox real**. Teste tudo no sandbox (seção 3 do guia do Pix) antes de qualquer valor real.
- **Dinheiro em desafios entre equipes pode ser regulado** como jogo de azar/aposta dependendo de como é feito. Veja a seção 1 do guia do Pix e consulte um advogado antes da Fase 2. Os campeonatos gratuitos da Fase 1 não têm essa questão.
- **Segurança: leia [`SEGURANCA.md`](SEGURANCA.md)**, que lista o que foi verificado e o que continua sendo risco (por exemplo: o administrador não tem verificação em duas etapas).
- **Nenhuma auditoria elimina todo o risco.** O projeto passou por revisão de segurança e testes automáticos, mas mantenha o servidor atualizado, as chaves em segredo, os backups fora do servidor e olhe os logs de vez em quando.
