# Prime Arena

Gerenciador de campeonatos de esports (inspirado no Battlefy) com **carteira por equipe** e **desafios equipe × equipe valendo créditos** (1 crédito = R$ 1,00). Visual grafite com vermelho e prata (a partir do logo oficial), interface em português do Brasil.

Jogos: **League of Legends, VALORANT, Counter-Strike 2, Fortnite, Apex Legends, Battlefield 6, Street Fighter, Call of Duty: Warzone, EA SPORTS FC e TFT.** (O CS:GO saiu do catálogo; registros antigos dele passam a abrir como CS2.)

> ⚠️ **Dinheiro real exige revisão jurídica e de conformidade antes de ir ao ar** — veja [Antes de operar com dinheiro real](#antes-de-operar-com-dinheiro-real).

## Sumário

- [O que tem](#o-que-tem) · [Rodando](#rodando-em-desenvolvimento) · [Testes](#testes) · [Formatos por jogo](#formatos-por-jogo)
- [Cargos e permissões](#cargos-e-permissões) · [Carteira e desafios](#carteira-e-desafios) · [Modelo de segurança](#modelo-de-segurança) · [Produção e hospedagem](#produção) · [Antes de operar com dinheiro real](#antes-de-operar-com-dinheiro-real)

## O que tem

- **Campeonatos**: criação em passos com formatos prontos por jogo (ou fases personalizadas), inscrição individual/por equipe com escalação (titulares e reservas), check-in, seeding (manual/aleatório/rating), chaves ao vivo, relato de placar pelos dois lados, disputas, W.O., desclassificação, premiação e colocação final.
- **Motor de chaves puro e testado** (`src/engine`): eliminação simples e dupla (com *reset* da grande final), pontos corridos, Suíço (Buchholz), grupos GSL, leaderboard de *battle royale* (pontos por colocação/abates, multiplicadores, *Match Point*, lobbies paralelos e reembaralhados) e classificação entre fases.
- **Conta**: cadastro, e-mail verificado, login com sessões (token só em hash), recuperação de senha, contas de jogo por título (Riot ID, SteamID, Epic, EA, Capcom ID, Activision…).
- **Checkout**: taxa de serviço de 10% por cima do valor do organizador, cupons, reserva de vaga de 30 min, fila de espera, reembolso automático ao desistir. Provedor `mock` (dev) ou Stripe (cartão + Pix) com webhook assinado e idempotente.
- **Organizador**: painel por campeonato (participantes, fases, partidas, financeiro, configurações) e organizações com equipe de staff. Cada organização pode ser **editada/renomeada** (dono e admin da organização) e **excluída** (só o dono ou um admin da plataforma, digitando o nome; a exclusão é lógica e o histórico fica; não exclui com campeonato aberto/em andamento nem com premiação a pagar).
- **Home e jogos**: banner "Qual jogo você joga?" com a parede de logos dos jogos (cada uma leva à página do jogo) e a logo de cada jogo ao lado do nome em listas, filtros e cartões (`public/games/`).
- **Cargos**: Admin (tudo), Organizador e Jogador; o admin promove e rebaixa pela tela **Admin → Usuários**.
- **Carteira da equipe** (só o **líder** movimenta): depósito por Pix, saque por Pix para o CPF verificado, extrato imutável. O admin liga e desliga a aba em **Admin → Configurações**.
- **Desafios equipe × equipe**: a aposta fica em custódia, o vencedor leva o pote menos 10%.
- **Admin**: usuários e cargos, todas as equipes, saldos de times excluídos, configurações, fila de KYC, saques em análise e presos, depósitos retidos, disputas, congelar/liberar carteira, ajuste auditado e conciliação do razão.
- **Marca**: logo Prime Arena (`public/brand/`): o PNG transparente oficial, só sem as margens vazias e redimensionado (pequeno no cabeçalho, maior no rodapé); favicon e imagem de compartilhamento saem dele.

## Rodando em desenvolvimento

Requer Node ≥ 22.13.

```bash
npm install
npm run setup             # cria o .env, o banco SQLite (prisma/dev.db) e carrega os dados de demonstração
npm run dev               # http://localhost:3000
```

`npm run setup` funciona igual no **Windows (PowerShell ou Prompt de Comando), macOS e Linux** e é seguro rodar de novo (não duplica os dados). Se você esquecer dele, o `npm run dev` percebe que falta o `.env` ou o banco e prepara tudo sozinho na primeira vez (nas seguintes não faz nada). Se aparecer erro de versão, instale o Node 22.13+ em https://nodejs.org. Para rodar de forma manual: `cp .env.example .env` (no Windows: `copy .env.example .env`), `npm run db:push` e `npm run db:seed`.

Logins do seed (senha `Prime#Arena2026`): `admin@primearena.local`, `organizador@primearena.local`, `lider1..4@primearena.local` (equipes com saldo), `jogador1..6@primearena.local`.

- **Pix simulado**: depois de gerar um Pix na carteira, abra `/dev/pix` (existe só fora de produção) para "pagar" a cobrança — o pagamento entra pelo **mesmo webhook assinado** do provedor real.
- **E-mails** (verificação, código de saque…) são gravados em `.dev-mail/` e impressos no console enquanto `SMTP_URL` estiver vazio.
- **Voltar ao estado de fábrica (só as contas padrão)**: feche o site (Ctrl+C no terminal do `npm run dev`) e rode `npm run reset`. Ele **apaga tudo** (contas criadas por você ou por outras pessoas, equipes, campeonatos, saldos, pedidos) e recria apenas os dados de demonstração, com as senhas de sempre. Pede que você digite `RESETAR` para confirmar e antes guarda uma cópia do banco em `prisma/backups/` (para voltar atrás, feche o site e copie o arquivo de volta para `prisma/dev.db`). Recusa-se a rodar em produção, em banco que não seja o SQLite local e com o site aberto. Opções: `npm run reset -- --yes` (sem perguntar), `--no-backup`, `--force`.

## Testes

```bash
npm run typecheck
npm test                  # Vitest: motor, catálogo, torneios, auth, carteira, saques, desafios, pagamentos, config
npm run e2e               # Playwright (sobe o app com um banco próprio, prisma/e2e.db, e aplica o seed)
```

No ambiente sem o Chromium do Playwright, aponte `PW_CHROMIUM_PATH` para um Chrome/Chromium instalado.

Os testes de unidade usam um banco SQLite temporário criado por `tests/global-setup.ts`. Cobrem, entre outros: todos os formatos de chave, conservação do dinheiro (conciliação do razão após cada fluxo), concorrência (saque/aceite/webhook em paralelo), idempotência de webhooks, limites e janelas de retenção, antifraude de saque, anti-conluio de desafios e a validação de configuração de produção. O E2E cobre navegação, controle de acesso, depósito, aceite de desafio, tentativa de saque forjado pelo DOM, o fluxo do admin, a troca de cargos, a exclusão de time com liberação do saldo e a chave da carteira. (O E2E recria o banco `prisma/e2e.db` antes de subir o servidor: `e2e/prepare-db.ts`.)

## Formatos por jogo

Cada jogo traz *presets* de formato baseados no que o cenário competitivo usa; todos são editáveis fase a fase (tipo, melhor de N, avanço, pontuação). A pontuação de *battle royale* segue as tabelas de referência publicadas (FNCS, ALGS, Warzone, TFT) e deve ser conferida contra o regulamento do seu evento.

| Jogo | Modos | Formatos prontos |
|---|---|---|
| **League of Legends** | 5v5 | Eliminação simples · Eliminação dupla · Estilo Worlds (Suíço 3-3 → playoffs) · Grupos + playoffs · Liga |
| **VALORANT** | 5v5 | Eliminação simples · Dupla (estilo VCT, Bo3/Bo5) · Champions (GSL em 4 grupos → dupla) · VCT Stage (2 grupos de 6 → dupla) |
| **Counter-Strike 2** | 5v5 | Eliminação simples · Dupla · Major (Suíço 3-3 → playoffs Bo3) · GSL + playoffs · Suíço aberto (5 rodadas) · Liga |
| **Fortnite** | Solo, Duos, Trios, Squads | Sessão de 6 partidas (tabela FNCS + 2 pts/abate) · Qualificatória + final · Box Fight (mata-mata 1v1) · Liga |
| **Apex Legends** | Duos, Trios | *Match Point* (50 pts + vitória, lobby de até 20) · Dia ALGS de 6 partidas (vários lobbies) · Qualificatória + final |
| **Battlefield 6** | RedSec Squads, 4v4 | RedSec (qualificatória + Gauntlet) · 4v4: simples, dupla, Suíço + playoffs, liga |
| **Street Fighter** | 1v1 | Dupla eliminação (Bo3, finais Bo5) · Pools → Top 8 · Simples com 3º lugar · Pontos corridos |
| **Call of Duty: Warzone** | Duos, Trios, Quads | Trios (abate × multiplicador de colocação) · Duos · Comunidade (pontos por colocação + abates) · Qualificatória + final |
| **EA SPORTS FC** | 1v1, Pro Clubs | Grupos + mata-mata · Copa · Liga (turno e returno) · Suíço + mata-mata · Liga de clubes |
| **TFT** | Solo | Aberto (6 partidas + final *Checkmate*) · Lobby único até 20 pts · Dia de pontos com lobbies reembaralhados |

## Cargos e permissões

| Cargo | O que pode |
|---|---|
| **Jogador** (padrão de quem se cadastra) | Criar time (e virar o **líder** dele automaticamente), convidar, inscrever o time em campeonatos, aceitar e criar desafios, depositar e sacar pela carteira do time que lidera. **Não** cria organização nem campeonato. |
| **Organizador** | Tudo do jogador, mais criar organizações e campeonatos e gerenciar os das organizações de que faz parte. |
| **Admin** | Tudo, em qualquer organização, campeonato ou time: promove e rebaixa usuários, exclui equipes (com motivo), analisa KYC, saques, depósitos retidos, disputas e saldos de times excluídos, liga e desliga a carteira. **Não movimenta o dinheiro de uma equipe** — só o líder faz isso — e nunca decide o que ele mesmo solicitou ou o que é do seu time (quatro olhos). |

- **Promover/rebaixar**: em **Admin → Usuários** o admin busca a pessoa e troca entre Jogador e Organizador. Não há como mudar o próprio cargo nem o de outro admin pela tela (administradores vêm do `ADMIN_EMAILS` do `.env`, com e-mail verificado). Quem volta a ser jogador perde a gestão das organizações e dos campeonatos e só continua como **equipe de apoio** (STAFF) onde foi adicionado; o admin vê quantas organizações e campeonatos ativos a pessoa tinha ao rebaixar.
- **Excluir time e saldo bloqueado**: o líder (ou um admin, com motivo) exclui o time em **Meus times → time → Excluir time**. Não exclui com desafio, saque, Pix pendente ou campeonato em andamento. Se houver saldo, ele fica **bloqueado** (carteira congelada; Pix que ainda chegue também espera). O ex-líder, com identidade verificada, pede a revisão em **Carteira → Equipes excluídas com saldo**; o admin confere e **libera ou recusa** em **Admin → Saldos de times excluídos**. Liberado, o saldo vira sacável sem as retenções de depósito/giro, mas o saque segue todas as regras de segurança (senha, código por e-mail, CPF do titular, liberação do admin).
- **Chave da carteira** (**Admin → Configurações**): liga e desliga a aba *Carteira*, os depósitos, os saques e os *Desafios*. Só liga se a configuração necessária estiver pronta (provedor de Pix real, chave de criptografia, agendador e URL pública — em desenvolvimento tudo isso é dispensado). Desativada, nada novo de dinheiro entra; Pix já pago é creditado, saque já pedido continua e desafio já aceito termina. Há ainda a chave **Exigir a liberação do admin em todo saque** (ligada por padrão).

## Carteira e desafios

**Regras de ouro**: tudo em **centavos inteiros**; 1 crédito = 100 centavos; só o **líder** da equipe deposita, saca e aposta; o saldo pertence à **equipe**.

- **Depósito (Pix)**: líder com KYC → cobrança Pix → o provedor paga → **webhook assinado** → o sistema **reconsulta o pagamento no provedor** (não confia no corpo do webhook), confere o valor e se o **CPF do pagador é o do líder verificado**. Se algo diverge, o valor fica **retido** para o admin; nada é creditado por "achismo".
- **Saque (Pix)**: líder · KYC aprovado · confirmação de **senha** · **código por e-mail** · limites por pedido/dia/equipe · valor **bloqueado na hora** · **liberação do admin em todo saque** (padrão; dá para trocar em *Admin → Configurações*) · **análise de risco** (pontuação) e **revisão humana com quatro olhos** acima do limite automático ou com sinais de fraude · **atraso configurável** para cancelar · destino **somente a chave Pix do CPF verificado**.
- **Sacável**: só o que foi **jogado e ganho**. Depósitos sem giro, depósitos das últimas 72 h (janela do MED/estorno do Pix) e prêmios das últimas 24 h ficam retidos — isso mata o ciclo "depositar → sacar" de lavagem/estorno.
- **Desafios**: a aposta da criadora é bloqueada ao criar e a do adversário ao aceitar (aceite **atômico**: só um adversário). O resultado é combinado: quem perde reconhece a derrota e o pote (menos 10%) é liberado; divergência vira **disputa** para o admin. Liquidação automática só para apostas pequenas. **Anti-conluio**: equipes com membros em comum não se enfrentam; mesmo IP e confrontos repetidos entre as mesmas equipes geram **alertas ao admin e elevam a pontuação de risco dos saques** de quem ganhou (levando à revisão humana).
- **Razão imutável**: cada movimento é um lançamento com **chave de idempotência única**; o saldo nunca fica negativo (atualização condicional); carteira congelada bloqueia saídas. A **conciliação** confere saldos × lançamentos, conservação do dinheiro entre carteiras e razão × depósitos/saques, e roda a cada ciclo do job e sob demanda no admin.

## Modelo de segurança

Nenhum sistema é "à prova de fraude". O desenho reduz a superfície e faz as falhas serem **seguras e detectáveis**:

| Ameaça | Defesa |
|---|---|
| Saldo falso por webhook forjado | Assinatura HMAC (tempo constante) **+ reconsulta ao provedor** + conferência de valor e de CPF + evento idempotente |
| Crédito/saque duplicado (reentrega, duplo clique, corrida) | Chaves de idempotência únicas no razão, transições de estado atômicas (`updateMany` condicional), transações serializáveis |
| Saldo negativo / gasto duplo | Atualização condicional: o saque ou aposta só passa se o saldo cobrir, no próprio `UPDATE` |
| Roubo de conta → saque | Senha + OTP por e-mail (hash, 5 tentativas), destino só no CPF verificado, atraso para cancelar, **trava de 24 h após troca/reset de senha**, limites, revisão humana |
| Lavagem por Pix de terceiros | CPF do pagador deve ser o do titular; depósito sem giro não sai |
| CPF de terceiros / contas múltiplas | CPF único por conta (HMAC), validado e **cifrado em repouso (AES-256-GCM)**, só os 4 últimos dígitos aparecem; 18+ |
| Conluio em desafios | Membros em comum bloqueados; alertas de IP/pares repetidos que **elevam o risco dos saques** dos vencedores; arbitragem; liquidação automática (por silêncio do adversário) só até R$ 100 |
| Abuso interno | Quatro olhos (admin não decide o que solicitou nem o que a sua equipe tem), ajustes só por lançamento de razão auditado, `AuditLog` |
| Força bruta / enumeração | Limite de tentativas por IP e conta, respostas genéricas, hash scrypt, sessões com token em hash, cookies `HttpOnly`/`SameSite` (+`Secure` em produção) |
| Falha ambígua do provedor | Saque fica em “enviando” para conciliação **humana** — nunca reenvia nem devolve sozinho (evita pagar duas vezes) |
| Erro de configuração | Em produção o app **recusa subir** com segredos fracos, provedores simulados ou sem chave de criptografia (`src/instrumentation.ts`) |
| Roubo da conta de administrador | O e-mail de `ADMIN_EMAILS` só vale confirmado, e ao confirmar a senha escolhida no cadastro é descartada: só quem lê a caixa de entrada cria a senha (impede cadastrar o e-mail do dono antes dele) |
| Rajada de tentativas de login | Limite atômico (reserva a tentativa **antes** do scrypt), por IP, por conta+IP e por conta; fila limitada de hashes; IPv6 por /64; ninguém bloqueia a conta de outra pessoa de fora |
| Abuso interno e contas problemáticas | Admin suspende/reativa contas (desconecta na hora); remover inscrição paga exige admin da organização; premiação anunciada só pode aumentar depois de haver inscritos; cupom e disputa com limites |
| Links de usuário | Só `http(s)` (javascript:/data: viravam XSS); redirecionamento após login só para dentro do site |
| Web | Cabeçalhos de segurança (CSP restritiva, HSTS em produção, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy), Server Actions com checagem de papel no servidor, validação com zod |

## Produção

**Colocar no ar (passo a passo, para quem não programa):**

| Guia | Para quê |
|---|---|
| [`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md) | Do `.zip` ao site online com HTTPS: VPS, domínio, `.env`, `docker compose up -d --build`, administrador, backups, atualização |
| [`docs/CONFIGURAR_EMAIL.md`](docs/CONFIGURAR_EMAIL.md) | Enviar o **e-mail de confirmação de conta** e de recuperação de senha (SMTP: Brevo, Resend, Gmail…) |
| [`COMECE_AQUI.md`](COMECE_AQUI.md) | A ordem dos guias e como lançar em duas fases |
| [`docs/SEGURANCA.md`](docs/SEGURANCA.md) | O que foi verificado e corrigido, o que ainda é risco, e a rotina de segurança semanal |
| [`docs/CONFIGURAR_PIX.md`](docs/CONFIGURAR_PIX.md) | Pix real (depósito e saque com liberação do admin), da conta no provedor até o QR Code, e o que resolver antes (conformidade) |

**Mais curto ainda:** em um servidor Ubuntu/Debian novo, `bash scripts/instalar-servidor.sh` faz 4 perguntas e instala tudo (Docker, firewall, segredos, `.env`, HTTPS).

**Hospedagem no ChatGPT Sites (Cloudflare Workers + banco D1):** o mesmo código também é montado para o Sites com `npm run build:sites`. Veja [`docs/SITES.md`](docs/SITES.md) e o texto pronto [`PROMPT_PARA_O_CHATGPT.md`](PROMPT_PARA_O_CHATGPT.md). Para testar localmente: `npm run preview:sites`, `npm run smoke:sites` e `npm run test:d1`. Para montar o `.zip` de entrega (só os arquivos versionados, conferido): `npm run empacotar`.

O pacote inclui `Dockerfile`, `docker-compose.yml` (site + HTTPS automático com Caddy + agendador + backup diário) e `.env.production.example`. Comandos úteis: `npm run secrets` (gera os segredos), `npm run mail:test -- voce@exemplo.com` (testa o e-mail), `npm run verificar-site -- https://seusite.com.br` (confere a segurança do site no ar), `npm run backup` (cópia do banco). Em **Admin → Configurações → Verificação do site** há um checklist e o botão de e-mail de teste.

**Lançamento em duas fases (recomendado):** primeiro só campeonatos (`WALLET_ENABLED="false"`, `PAYMENTS_PROVIDER="none"`), depois a carteira com Pix quando o provedor estiver aprovado e testado no sandbox.

Em resumo, o que a produção exige (o site **recusa subir** se faltar; o motivo aparece nos logs):

1. **Banco**: o caminho testado é **uma instância** com **SQLite em disco persistente + backup** (já pronto no `docker-compose.yml`). Postgres exigiria trocar o `provider` em `prisma/schema.prisma` e revalidar as transações serializáveis (nova tentativa em `P2034`) e os testes; não foi validado.
2. **Segredos** (veja `.env.production.example`): `APP_SECRET` (≥ 32), `DATA_ENCRYPTION_KEY` (**faça backup**: sem ela os CPFs cifrados não se recuperam), `CRON_SECRET`, `ADMIN_EMAILS`, `SMTP_URL`, `APP_URL` com `https://`.
3. **Proxy**: `TRUST_PROXY=true` apenas atrás de um proxy que **sobrescreve** `x-forwarded-for` (o Caddy do compose faz isso; o site usa o último endereço da lista). Sem proxy, `false`.
4. **Agendador**: `POST /api/cron/wallet` a cada 1–5 min com `Authorization: Bearer $CRON_SECRET` (envia saques liberados, expira cobranças/desafios, concilia). O `docker-compose.yml` já faz isso a cada 2 min.
5. **Webhooks** (Fase 2): aponte o provedor para `/api/webhooks/pix` e `/api/webhooks/pix/transfer-authorization`; o Stripe para `/api/webhooks/stripe` (com `PIX_PROVIDER="stripe"`, esse é o único endereço e ele também recebe os depósitos).
6. **Freio de emergência**: `PAYOUTS_PAUSED=true` suspende todos os saques sem derrubar o resto.
7. Sem Docker: `npm ci && npm run build && npx prisma db push && npm start` (veja a seção 12 de `docs/HOSPEDAGEM.md`).

## Antes de operar com dinheiro real

- **Asaas (Pix)**: o adaptador foi escrito pela documentação pública e **não foi validado contra o sandbox** (a documentação estava inacessível durante o desenvolvimento). Valide cada fluxo (cobrança, webhook, transferência, autorização, estorno) no sandbox antes de qualquer valor real. O provedor é uma interface (`src/server/pix`) — dá para trocar.
- **Stripe (Pix, `PIX_PROVIDER="stripe"`)**: cobra os depósitos pelo Stripe Checkout, mas o Stripe **não paga Pix a terceiros**: os saques são pagos **manualmente** por um administrador (Admin → Saques → Para pagar à mão). Também **não foi validado contra a API real**, e o CPF do pagador é declarado por ele na página do Stripe. Detalhes e dúvidas abertas em [`docs/CONFIGURAR_PIX.md`](docs/CONFIGURAR_PIX.md), seção 10.
- **Stripe**: implementado por REST com verificação de assinatura e testado só com eventos simulados, não contra a conta real.
- **Jurídico/conformidade** (fora do escopo de código): apostas entre jogadores com dinheiro podem se enquadrar em regras de **jogos de azar/apostas de quota fixa/SPA-MF** no Brasil, e processadores de pagamento costumam **proibir** esse uso. Também envolvem **KYC/PLD**, **LGPD** (CPF), proteção de menores e termos de uso. Consulte um advogado especializado e o seu provedor de pagamento antes de abrir ao público.
- **Segurança**: faça um **pentest** independente, revise logs de auditoria e mantenha o limite de saque automático baixo no início.
- Sem **testes de carga** nem **monitoramento** configurados; adicione alertas para conciliação divergente, saques presos e depósitos retidos.
