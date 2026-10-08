# Configurar o Pix (depósito e saque) — do zero até funcionando

Este guia leva do "não tenho nada" até o QR Code de depósito e o saque funcionando, com **todo saque liberado por um administrador** antes de sair dinheiro.

> **Ordem recomendada:** primeiro coloque o site no ar **só com campeonatos** (`WALLET_ENABLED="false"`) seguindo [`HOSPEDAGEM.md`](HOSPEDAGEM.md) e [`CONFIGURAR_EMAIL.md`](CONFIGURAR_EMAIL.md). Só depois, com o site funcionando e o Asaas aprovado, siga este guia para ligar o Pix (seção 4.1).

> **Prefere cobrar os depósitos pelo Stripe em vez do Asaas?** Veja a **seção 10 (Depósitos pelo Stripe)**. Atenção: com o Stripe os **saques são pagos à mão** por um administrador, porque o Stripe não envia Pix para terceiros.

> ⚠️ **Leia a seção 1 antes de gastar tempo.** O maior risco deste projeto não é técnico: é o seu provedor de pagamentos aceitar (ou não) este tipo de produto.

## Como funciona (visão geral)

```
DEPÓSITO                                         SAQUE
líder pede um valor                              líder pede o saque (senha + código por e-mail)
  → o sistema cria uma cobrança Pix no provedor    → fica "Em análise"  ← ADMIN aprova ou recusa
  → o jogador vê o QR Code / copia-e-cola          → espera alguns minutos (dá tempo de cancelar)
  → paga no app do banco                           → o agendador envia o Pix ao provedor
  → o provedor avisa o sistema (webhook)           → o provedor pergunta ao sistema "autorizo?" (2ª trava)
  → o sistema reconsulta o pagamento e credita     → o Pix sai SÓ para a chave CPF do titular verificado
```

O sistema **não** fala direto com o banco. Ele usa um **provedor de pagamentos (PSP)** com API Pix. O projeto já traz o adaptador do **Asaas** e um **simulador** para testar sem dinheiro.

---

## 1. Preciso de conta em alguma instituição? Sim.

Precisa de uma **conta no provedor de pagamentos**, aprovada por ele (cadastro com documentos; pode levar alguns dias). Este projeto vem preparado para o **Asaas**. Outro provedor serve, mas exige escrever um adaptador (a interface fica em `src/server/pix/types.ts`).

### ⚠️ Conformidade — faça ANTES de qualquer outra coisa

Este produto tem **aposta entre jogadores com dinheiro** (desafios equipe × equipe). Provedores de pagamento costumam restringir esse tipo de atividade:

- A central de ajuda do Asaas trata **apostas de quota fixa (bets)** como atividade **restrita**: aceita apenas **pessoa jurídica** de natureza específica, **em negociação com o time Comercial** e com os registros exigidos pela Lei nº 14.790/2023. Atividades de jogos de azar sem autorização são proibidas, e a conta pode ser **suspensa ou cancelada** se houver indício de uso fora dos termos.
- **Entre em contato com o comercial do provedor, descreva o produto exatamente como ele é** (desafios com saldo, taxa de 10% do pote, saque por Pix) e peça por escrito se pode operar. Não abra para o público antes disso.
- Consulte um **advogado** sobre enquadramento (jogos de azar, apostas de quota fixa, SPA/MF), PLD/KYC e LGPD (o sistema guarda CPF).

Isto não é aconselhamento jurídico: é o que precisa ser resolvido por quem entende do assunto.

---

## 2. Fase 1 — testar tudo SEM dinheiro (simulador)

Já funciona do jeito que vem. No terminal, na pasta do projeto:

```bash
npm install
npm run setup        # cria o .env, o banco e os dados de demonstração
npm run dev          # http://localhost:3000
```

**Testar o depósito:** entre como `lider1@primearena.local` (senha `Prime#Arena2026`) → *Carteira* → abra a equipe → informe o valor → *Gerar Pix*. Aparece o QR Code e o copia-e-cola. Para "pagar", abra **http://localhost:3000/dev/pix** e clique em *Pagar (CPF do titular)*. O pagamento entra pelo mesmo caminho do provedor real (webhook assinado → reconsulta → crédito).
Teste também *Pagar com CPF de terceiro*: o sistema **retém** o valor e ele aparece em **Admin → Depósitos retidos**.

**Testar o saque com liberação do admin** (veja a seção 5 para ligar a liberação obrigatória):

1. Como líder, em *Carteira* → *Sacar por Pix* (precisa ter saldo **sacável**, veja o quadro abaixo).
2. O código de 6 dígitos vai por e-mail (em desenvolvimento aparece no terminal e na pasta `.dev-mail/`).
3. Entre como `admin@primearena.local` → **Admin → Saques** → *Aprovar* (escreva o que conferiu).
4. Depois do atraso (padrão 30 min), o agendador envia. Em teste, rode o agendador na mão (seção 5, passo 3) e finalize em `/dev/pix` com *Banco: pago*.

> **Por que "sacável" costuma ser R$ 0 nos testes?** Por segurança só sai dinheiro que foi **jogado e ganho**, e depósitos das últimas 72 h e prêmios das últimas 24 h ficam retidos. Para testar rápido, no `.env` coloque `DEPOSIT_HOLD_HOURS=0`, `WIN_HOLD_HOURS=0`, `WITHDRAW_DELAY_MINUTES=1`, e faça uma equipe ganhar um desafio contra outra.

---

## 3. Fase 2 — Sandbox do Asaas (ainda sem dinheiro real)

O sandbox é um ambiente de teste do próprio Asaas. **Valide aqui todos os fluxos antes da produção.**

### 3.1 Conta e chave de API
1. Crie uma conta de **sandbox** em <https://sandbox.asaas.com> (é separada da conta de produção).
2. Na conta: **menu do usuário → Integrações → Gerar nova API Key**. A chave só pode ser criada pela interface web, por usuário administrador, e **aparece uma única vez**: copie e guarde.
3. As chaves de sandbox e de produção são diferentes. URLs: sandbox `https://api-sandbox.asaas.com/v3`, produção `https://api.asaas.com/v3` (o sistema escolhe pela variável `ASAAS_ENV`).

### 3.2 Gerar os segredos
Um comando gera tudo de uma vez (funciona no Windows, Mac e Linux; precisa do Node):

```bash
npm run secrets
```

Ele imprime `APP_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, `ASAAS_WEBHOOK_TOKEN` e `ASAAS_TRANSFER_AUTH_TOKEN` (dois tokens **diferentes**), prontos para colar no `.env`. Se o site já está no ar, **não troque** `DATA_ENCRYPTION_KEY` nem `APP_SECRET`: gere só o que ainda falta.

Os tokens de webhook do Asaas precisam ter de 32 a 255 caracteres, sem espaços, e **não podem ser a sua API Key**. Os gerados pelo comando atendem.

### 3.3 Variáveis do `.env`
```ini
WALLET_ENABLED="true"               # no servidor, depois de salvar o .env: docker compose up -d
PIX_PROVIDER="asaas"
ASAAS_ENV="sandbox"
ASAAS_API_KEY="(a chave de sandbox)"
ASAAS_WEBHOOK_TOKEN="(token 1)"
ASAAS_TRANSFER_AUTH_TOKEN="(token 2)"
DATA_ENCRYPTION_KEY="(base64)"
CRON_SECRET="(token 3)"
APP_URL="https://SEU-ENDERECO-PUBLICO"
PIX_REQUIRE_PAYER_DOC="true"        # veja a seção 7
WITHDRAW_AUTO_APPROVE_MAX_CENTS="0" # TODO saque exige o admin (seção 5)
```

### 3.4 Um endereço público com HTTPS
O Asaas precisa **alcançar o seu servidor** para entregar os webhooks, então `localhost` não serve. Se o site já está hospedado como em [`HOSPEDAGEM.md`](HOSPEDAGEM.md), o endereço é o seu domínio (o HTTPS é automático). Para testar da sua máquina, sem hospedagem, use um túnel (por exemplo **Cloudflare Tunnel** ou **ngrok**), que dá um endereço `https://...` apontando para o seu `localhost:3000`.

### 3.5 Webhook de cobranças e transferências
No Asaas: **Integrações → Webhooks → criar** (o token é enviado no cabeçalho `asaas-access-token`):

| Campo | Valor |
|---|---|
| URL | `https://SEU-ENDERECO/api/webhooks/pix` |
| Token de autenticação | o `ASAAS_WEBHOOK_TOKEN` |
| Eventos de **cobrança** | `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_REFUND_IN_PROGRESS` |
| Eventos de **transferência** | `TRANSFER_DONE`, `TRANSFER_FAILED`, `TRANSFER_CANCELLED` |

Se a tela do Asaas separar os webhooks por tipo (cobranças, transferências…), crie um para cada tipo apontando para a **mesma URL**. Confira os nomes exatos dos eventos na tela: o sistema só reage aos listados acima e ignora o resto.

### 3.6 Validação de saque via webhook (a segunda trava)
O Asaas oferece um mecanismo em que, antes de executar cada saque feito por API, ele pergunta ao **seu** servidor se pode seguir: cerca de 5 s depois do pedido ele faz um `POST` na URL configurada e espera `{"status":"APPROVED"}` ou `{"status":"REFUSED","refuseReason":"..."}`; se a chamada falhar 3 vezes ou não vier resposta válida, a operação é cancelada. Ative-o seguindo a página oficial **"Mecanismo para validação de saque via webhooks"** (link na seção 9), com:

| Campo | Valor |
|---|---|
| URL | `https://SEU-ENDERECO/api/webhooks/pix/transfer-authorization` |
| Token | o `ASAAS_TRANSFER_AUTH_TOKEN` |

O sistema só responde `APPROVED` se **o saque existe, está "enviando", o valor é exatamente o aprovado, a carteira não está congelada e a chave Pix de destino é o CPF do titular verificado**. Qualquer outra coisa é recusada e registrada em auditoria. Isso significa que, mesmo que alguém roube a sua chave de API, **não consegue sacar para outro destino**.

### 3.7 IP autorizado da chave de API
Por padrão, retiradas pedidas por API geram um "evento crítico" no Asaas que **espera aprovação manual no painel ou no aplicativo do Asaas**. Há duas formas de operar:

- **Aprovação dupla (mais segura):** deixe como está. O admin libera no **seu** painel e, depois, alguém aprova também no Asaas. Mais lento, e o saque só sai quando as duas aprovações acontecerem.
- **Só a aprovação do seu painel:** cadastre o **IP fixo do seu servidor** na lista de IPs autorizados da chave e desative a aprovação manual para esses IPs (a tela e os limites estão na página oficial *Whitelist de IPs*, seção 9). Requisições vindas de outros IPs recebem `403`. Exige hospedar num servidor com **IP de saída fixo** (um VPS costuma ter; serviços "serverless" geralmente não).

### 3.8 Testar no sandbox
1. Entre como líder, gere um Pix de R$ 10 na carteira (o QR Code e o copia-e-cola devem aparecer).
2. Simule o pagamento no sandbox (o Asaas documenta como em *"Como testar funcionalidades em sandbox"* e *"Testar pagamento de QRCodes Pix"*).
3. O saldo deve aumentar **uma vez só**, mesmo se o webhook chegar repetido.
4. Faça um saque (seção 5) e confirme: sai da fila do admin → agendador envia → o Asaas consulta a autorização → `TRANSFER_DONE` → status *Pago*.
5. Teste também uma recusa do admin e um estorno.

---

## 4. Como o QR Code de depósito é gerado
Ao clicar em *Gerar Pix*, o sistema cria um cliente e uma **cobrança Pix** no Asaas, busca o QR Code dinâmico dessa cobrança e mostra a **imagem** e o **copia-e-cola**. A cobrança vale 30 minutos. O crédito só acontece **depois** que o Asaas avisa por webhook **e** o sistema reconsulta a cobrança e confere o valor. Nunca se credita só pelo aviso.

---

## 4.1 Ativar a Carteira para os usuários

A aba **Carteira**, os depósitos, os saques e os **Desafios** só aparecem para os usuários quando o admin ativa a chave em **Admin → Configurações → Carteira de equipe, depósitos e saques**. O site só permite ligar quando a configuração necessária está pronta (cada item mostra o que falta):

- **Provedor de Pix real** (não o simulador) — seção 3;
- **Chave de criptografia** dos CPFs (`DATA_ENCRYPTION_KEY`) — seção 3.2;
- **Agendador** (`CRON_SECRET`) — seção 5.3;
- **URL pública** com HTTPS (`APP_URL`) — seção 3.4.

Em desenvolvimento (fora de produção) esses itens são dispensados e a chave já vem ligada. Desativada, a aba some, novos depósitos, saques e desafios são bloqueados, mas Pix já pago continua sendo creditado e saques já pedidos continuam na fila do admin.

---

## 5. Saque 100% liberado pelo administrador

### 5.1 Ligar a liberação obrigatória
**Pela interface (padrão):** em **Admin → Configurações → Liberação dos saques pelo administrador**, a opção vem **ligada**: todo saque, mesmo pequeno e sem sinal de risco, espera a sua análise. Você pode permitir saques pequenos automáticos ali mesmo (é auditado).

**Pelo `.env`** (reforço, e vale também com a chave desligada para saques acima do limite):
```ini
WITHDRAW_AUTO_APPROVE_MAX_CENTS="0"
```
Com `0`, **todo saque** (o mínimo é R$ 20) vai para **"Em análise"** e só sai depois de um administrador aprovar. (Com o valor padrão de R$ 300, saques pequenos e sem sinais de risco seriam aprovados sozinhos.)

### 5.2 O caminho completo de um saque
1. O **líder** pede o saque: precisa de identidade verificada, senha e o **código de 6 dígitos por e-mail**. O valor fica bloqueado na hora.
2. O saque aparece em **Admin → Saques → Em análise**, com os sinais de risco.
3. O **admin** clica em *Aprovar* (escrevendo o que conferiu) ou *Recusar* (com o motivo, que a equipe vê).
   - **Quatro olhos:** o admin **não pode** decidir um saque que ele mesmo pediu nem de uma equipe da qual faz parte.
4. Depois de aprovado, o saque espera `WITHDRAW_DELAY_MINUTES` (padrão 30). Nesse intervalo o líder ainda pode **cancelar**.
5. O **agendador** envia o Pix ao provedor, o provedor pergunta ao sistema se autoriza (seção 3.6) e o Pix sai **somente para a chave CPF do titular**.
6. O provedor avisa por webhook e o status vira *Pago*.

### 5.3 O agendador (sem ele, nada é enviado)
**Com o `docker-compose.yml` deste projeto o agendador já roda sozinho** (o serviço `cron` chama o site a cada 2 minutos). Em **Admin → Configurações → Verificação do site** o item "Agendador" mostra quando foi a última rodada: se estiver vermelho, veja `docker compose logs cron`. O texto abaixo é para quem hospeda de outro jeito.

Um saque aprovado só é enviado quando o endereço abaixo é chamado. Ele também expira cobranças, concilia o razão e liquida desafios. **Agende a cada 1 a 5 minutos:**

```
POST https://SEU-ENDERECO/api/cron/wallet
Authorization: Bearer SEU_CRON_SECRET
```

Opções para agendar: um serviço de cron externo (por exemplo cron-job.org), um agendador do próprio provedor de hospedagem ou um GitHub Actions com `schedule`. Para testar na sua máquina:

```bash
# Mac / Linux / Git Bash
curl -X POST http://localhost:3000/api/cron/wallet -H "Authorization: Bearer SEU_CRON_SECRET"
# Windows (PowerShell)
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/cron/wallet -Headers @{ Authorization = "Bearer SEU_CRON_SECRET" }
```

### 5.4 Saque "preso"
Se o provedor der uma resposta ambígua, o saque fica em **"enviando"** e **nunca** é reenviado nem devolvido automaticamente (evita pagar duas vezes). O admin confere no painel do provedor e decide em **Admin → Saques → Presos em "enviando"**: *Confirmar que foi PAGO* ou *Confirmar que NÃO saiu (devolver)*.

---

## 6. Ir para a produção
1. **Provedor aprovado por escrito** para este tipo de produto (seção 1).
2. Conta **de produção** no Asaas, com a documentação aprovada. **Gere a chave de produção e recrie os webhooks na conta de produção** (a de sandbox não vale lá).
3. No `.env` de produção: `ASAAS_ENV="production"`, a chave de produção e os mesmos nomes de variáveis. O app **recusa subir** se faltar algo (veja `src/lib/env.ts` e `.env.production.example`): `APP_URL` com https, `SMTP_URL`, `ADMIN_EMAILS`, `APP_SECRET` (32+), `DATA_ENCRYPTION_KEY`, `CRON_SECRET` (24+), `TRUST_PROXY`, as variáveis do Asaas e a configuração dos pagamentos de inscrição (`PAYMENTS_PROVIDER="none"` se não usar Stripe).
4. **Banco e backup.** O projeto roda com **SQLite no volume do servidor** (um servidor só) e o `docker-compose.yml` faz **uma cópia por dia** (guarda 14). Copie essas cópias para **fora do servidor** com frequência (veja `HOSPEDAGEM.md`). **Faça backup da `DATA_ENCRYPTION_KEY`**: sem ela os CPFs cifrados não se recuperam. Postgres exigiria adaptar o projeto e testar de novo; não é o caminho testado aqui.
5. **IP fixo** do servidor na chave de API (seção 3.7), se escolher o fluxo sem aprovação dupla.
6. **Limites baixos no começo** (`DEPOSIT_MAX_CENTS`, `WITHDRAW_MAX_CENTS`, `WITHDRAW_DAILY_TEAM_CENTS`) e o primeiro teste real com **R$ 10**.
7. **Freio de emergência:** `PAYOUTS_PAUSED="true"` suspende todos os saques sem derrubar o resto.
8. Acompanhe **Admin → Resumo**: filas de KYC, saques, depósitos retidos e disputas, e a **conciliação do razão**.

> Os pagamentos de **inscrição em campeonato** (cartão/Pix de checkout) são outro fluxo, pela Stripe (`PAYMENTS_PROVIDER`). A carteira, os desafios e os saques usam o Pix descrito aqui.

---

## 7. Limitações que você precisa conhecer
- **O adaptador do Asaas nunca foi testado contra o sandbox.** Foi escrito pela documentação pública, e a rede onde ele foi desenvolvido bloqueia o site da documentação. Os pontos conferidos por resumos da documentação (formato do webhook de autorização, tokens, URLs de sandbox e produção, geração de chave) batem com o adaptador, mas **só o teste da seção 3.8 prova que funciona**. Ele é defensivo: se algo vier diferente do esperado, o depósito não credita e o saque devolve o saldo.
- **O CPF de quem pagou o depósito não é conferido com o Asaas.** O objeto de pagamento que o adaptador consulta não traz o documento do pagador, e não confirmei se existe outro endpoint para isso. Sem essa informação, o sistema credita o depósito, e o que protege o saque é: só sai para o CPF do titular, retenção de 72 h, giro obrigatório, pontuação de risco (depósito sem pagador verificado pesa) e a sua liberação manual. **Recomendo `PIX_REQUIRE_PAYER_DOC="true"`**: todo depósito cujo pagador o provedor não informou fica em **Admin → Depósitos retidos** para você conferir no painel do banco e liberar. É mais trabalho manual e mais seguro, até a verificação do pagador estar validada no sandbox.
- **Um servidor só.** O projeto foi pensado e testado para **uma** instância do site com SQLite. Não rode duas cópias do site ao mesmo tempo apontando para o mesmo banco.
- **Tarifas e limites do provedor** (tarifa por cobrança Pix, tarifa por transferência, limite noturno do Pix) não estão no sistema: consulte a tabela de preços do Asaas.
- Nenhum sistema é 100% à prova de fraude: faça um teste de invasão independente antes de abrir ao público.

---

## 8. Se algo der errado
| Sintoma | Verifique |
|---|---|
| QR Code não aparece | `ASAAS_API_KEY` e `ASAAS_ENV` batem (chave de sandbox só no sandbox)? Veja o terminal: o erro do provedor aparece como `[asaas] POST /payments → <código>`. |
| Pagou e o saldo não subiu | O webhook chegou? `APP_URL` público e HTTPS? Token do webhook igual ao `ASAAS_WEBHOOK_TOKEN`? O depósito pode estar em **Depósitos retidos**. |
| Saque aprovado e nunca sai | O agendador está rodando e com o `CRON_SECRET` certo? Já passou o atraso (`WITHDRAW_DELAY_MINUTES`)? |
| Saque recusado pelo provedor | Veja o aviso `[SEGURANÇA] transferência recusada` no terminal e a auditoria: valor diferente, carteira congelada, chave que não é o CPF do titular ou saques pausados. |
| Saque em "Presos" | Seção 5.4. |

---

## 9. Fontes (páginas oficiais do Asaas)
A rede da sessão em que este guia foi escrito bloqueia `docs.asaas.com`, então os pontos acima vêm de **resumos de busca** dessas páginas: **confirme tudo diretamente no site antes de operar**.

- [Introdução - Pix](https://docs.asaas.com/docs/pix)
- [Mecanismo para validação de saque via webhooks](https://docs.asaas.com/docs/mecanismo-para-validacao-de-saque-via-webhooks)
- [Chaves de API](https://docs.asaas.com/docs/chaves-de-api) · [Sandbox](https://docs.asaas.com/docs/sandbox) · [Como configurar sua conta no Sandbox](https://docs.asaas.com/docs/como-configurar-sua-conta-no-sandbox)
- [Eventos para cobranças](https://docs.asaas.com/docs/webhook-para-cobrancas) · [Receba eventos do Asaas no seu endpoint de Webhook](https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook)
- [Whitelist de IPs](https://docs.asaas.com/docs/whitelist-de-ips)
- [Transferir para conta de outra Instituição ou chave Pix](https://docs.asaas.com/reference/transferir-para-conta-de-outra-instituicao-ou-chave-pix)
- [Testar pagamento de QRCodes Pix](https://docs.asaas.com/docs/testar-pagamento-de-qrcodes-pix) · [Como testar funcionalidades em sandbox](https://docs.asaas.com/docs/como-testar-funcionalidades)
- [Quais são as atividades econômicas de uso restrito no Asaas?](https://central.ajuda.asaas.com/hc/pt-br/articles/31406442119067-Quais-s%C3%A3o-as-atividades-econ%C3%B4micas-de-uso-restrito-no-Asaas) · [Termos e Condições de Uso](https://central.ajuda.asaas.com/hc/pt-br/articles/32096847160859-Termos-e-Condi%C3%A7%C3%B5es-de-Uso)

---

## 10. Depósitos pelo Stripe (alternativa ao Asaas)

Com `PIX_PROVIDER="stripe"` o depósito é cobrado por uma **página de pagamento do Stripe** (Stripe Checkout, só com Pix). O líder clica em **Pagar com Pix**, o Stripe mostra o QR Code e o copia-e-cola, e o saldo entra sozinho depois que o Stripe confirma. Todas as proteções do Asaas continuam valendo: aviso assinado (webhook) → o sistema **reconsulta o Stripe** → confere valor e moeda → confere o CPF de quem pagou → credita uma vez só; estorno e contestação retiram o crédito.

### 10.1 O que muda em relação ao Asaas

| | Asaas | Stripe |
|---|---|---|
| Depósito | QR Code e copia-e-cola dentro do site | Botão **Pagar com Pix** que abre a página segura do Stripe |
| CPF de quem pagou | O Asaas não informa (depósito fica retido para você conferir) | O pagador digita o CPF na página do Stripe; se for diferente do titular, ou não vier, o depósito fica **retido** |
| Saque | Automático, depois que o admin libera | **Manual**: o admin libera e depois **paga o Pix no app do próprio banco** (seção 10.5) |
| Webhooks | `/api/webhooks/pix` e `/api/webhooks/pix/transfer-authorization` | Só `/api/webhooks/stripe` (o mesmo endereço das inscrições) |

### 10.2 Antes de começar

1. Uma conta **Stripe do Brasil** aprovada, com o **Pix ativado** (Painel do Stripe → Configurações → Métodos de pagamento → Pix; o nome exato dos menus muda de tempos em tempos). A Stripe pode pedir dados e uma análise antes de liberar o Pix.
2. **Conformidade:** a Stripe mantém uma lista de negócios restritos que costuma incluir jogos de azar e apostas. Descreva o produto exatamente como ele é (desafios entre equipes valendo créditos, taxa sobre o pote) e peça uma resposta **por escrito** antes de operar. Vale tudo o que está na seção 1.
3. O site no ar com HTTPS (`APP_URL`), `DATA_ENCRYPTION_KEY` e `CRON_SECRET` definidos (seções 3.2 e 5.3), como no Asaas.

### 10.3 Passo a passo

**Faça tudo primeiro no modo de teste do Stripe** (chave de teste), sem dinheiro de verdade.

1. **Chave secreta.** No painel do Stripe: **Desenvolvedores → Chaves de API**. Copie a **Chave secreta** (`sk_test_…` no modo de teste, `sk_live_…` em produção). Ela vira o `STRIPE_SECRET_KEY`. Nunca mostre essa chave a ninguém (nem a uma IA). Se preferir uma *chave restrita* (`rk_…`), ela precisa de permissão de escrita em *Checkout Sessions* e de leitura em *PaymentIntents* e *Charges*; isso não foi validado, então teste no modo de teste.
2. **Webhook.** **Desenvolvedores → Webhooks → Adicionar endpoint**:
   - **URL:** `https://SEU-ENDERECO/api/webhooks/stripe`
   - **Eventos** (marque exatamente estes seis):
     `checkout.session.completed` · `checkout.session.async_payment_succeeded` · `checkout.session.async_payment_failed` · `checkout.session.expired` · `charge.refunded` · `charge.dispute.created`
   - Depois de criar, copie o **Segredo de assinatura** (`whsec_…`). Ele vira o `STRIPE_WEBHOOK_SECRET`.
   - Se você já usa o Stripe para as inscrições em campeonatos, o endereço é o **mesmo**: só acrescente os eventos que faltam (`charge.refunded` e `charge.dispute.created`) ao endpoint existente. Não cadastre também `/api/webhooks/pix`.
   - O modo de teste e o modo real têm endpoints e segredos **diferentes**: crie um endpoint em cada um.
3. **Variáveis do `.env`** (no ChatGPT Sites, as mesmas variáveis vão nos segredos do site):

```ini
WALLET_ENABLED="true"
PIX_PROVIDER="stripe"
STRIPE_SECRET_KEY="sk_test_..."          # troque por sk_live_... só no final
STRIPE_WEBHOOK_SECRET="whsec_..."
PIX_REQUIRE_PAYER_DOC="true"             # depósito sem o CPF do pagador fica retido (já é o padrão em produção)
WITHDRAW_AUTO_APPROVE_MAX_CENTS="0"      # TODO saque espera um admin (seção 5.1)
APP_URL="https://SEU-ENDERECO"
DATA_ENCRYPTION_KEY="(base64)"
CRON_SECRET="(token)"
# STRIPE_PIX_COLLECT_TAX_ID="false"      # só se o Stripe recusar o pedido de CPF (veja 10.6)
```

   Não precisa de nenhuma variável do Asaas. Em produção o site **recusa subir** com `PIX_PROVIDER="stripe"` sem as duas chaves e recusa uma chave de teste (`sk_test_…`).
4. **Ligue a carteira** em **Admin → Configurações** (seção 4.1). A lista de pendências mostra "Provedor de Pix (Stripe)".

### 10.4 Como testar no modo de teste do Stripe

1. Entre como líder (com identidade verificada), abra a carteira da equipe, informe um valor e clique em **Gerar Pix**. Aparece o botão **Pagar com Pix**.
2. Clique nele: abre a página do Stripe. Escolha o Pix e informe o CPF e os dados pedidos:
   - para ver o depósito ser **creditado**, informe o **mesmo CPF** do cadastro do líder;
   - para ver o depósito ficar **retido**, informe outro CPF (o Stripe indica `000.000.000-00` como CPF de teste) ou deixe em branco: ele aparece em **Admin → Depósitos retidos**.
3. No modo de teste a página não mostra um QR de verdade: use o botão **Simular leitura** (*Simulate scan*). Abre uma página de teste do Stripe em que você escolhe **autorizar** o pagamento (ou **expirar**).
4. Em alguns segundos o site recebe o aviso do Stripe, reconsulta e a carteira mostra o crédito (**uma vez só**, mesmo que o aviso chegue repetido). Confira no Stripe, em **Desenvolvedores → Webhooks → seu endpoint**, que as entregas aparecem com resposta **200**.
5. Teste também: **expirar** (o depósito vira "Expirado" e não credita), e um **reembolso** feito pelo painel do Stripe (**Pagamentos → o pagamento → Reembolsar**): o crédito é retirado, a carteira é congelada e, se o saldo já foi gasto, vira dívida.
6. Para testar na sua máquina sem hospedagem, a CLI do Stripe encaminha os avisos: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` (ela imprime o `whsec_…` a usar no `.env`).

### 10.5 Saques manuais (a limitação do Stripe)

O Stripe cobra, mas **não paga Pix para terceiros**: os repasses dele só vão para a conta bancária do dono da conta Stripe. Por isso, com `PIX_PROVIDER="stripe"`:

1. O líder pede o saque (senha + código por e-mail), o admin aprova (**Admin → Saques → Em análise**) e passa o atraso de cancelamento. Tudo igual ao Asaas, inclusive os "quatro olhos" e o freio `PAYOUTS_PAUSED`.
2. O agendador **não envia nada**: o saque vira "Aguardando pagamento manual" e aparece em **Admin → Saques → Para pagar à mão no banco**, com o **valor líquido** e o nome do titular verificado. O líder vê "Aguardando pagamento pelo administrador".
3. O admin clica em **Mostrar chave Pix**: o sistema mostra o **CPF verificado do titular** (a única chave para a qual o saque pode ir). Cada clique fica registrado na auditoria. Não funciona com saques pausados, carteira congelada ou titular suspenso, nem para o solicitante ou alguém da equipe dele.
4. O admin faz o Pix, **no app do seu banco**, para esse CPF, no valor líquido mostrado.
5. De volta ao site: **Confirmar que PAGUEI** (escreva o que conferiu; o código E2E do comprovante é opcional). O saque vira *Pago* e o dinheiro sai da custódia. Se não for pagar, **NÃO paguei (devolver ao saldo)** devolve o valor à carteira.

Cuidados: o dinheiro dos depósitos fica no seu saldo do Stripe e chega ao seu banco no calendário de repasses do Stripe, então **planeje o caixa** para pagar os saques; a conciliação automática ignora saques manuais (não existe transferência para conferir); cada saque dá trabalho a uma pessoa, e quem paga pode errar o valor ou o CPF: confira sempre antes de enviar. Comece com limites baixos (`WITHDRAW_MAX_CENTS`, `WITHDRAW_DAILY_TEAM_CENTS`).

### 10.6 Limitações e o que ainda não foi confirmado

- **O adaptador nunca foi testado contra o Stripe de verdade.** Foi escrito a partir de resumos da documentação, porque `docs.stripe.com` não abria na rede em que foi desenvolvido. O teste da seção 10.4 é o que prova que funciona. Se algo vier diferente do esperado, o depósito **não credita** (nada é creditado por resposta de API ou corpo de webhook).
- **CPF do pagador.** Ele é **digitado pelo pagador** na página do Stripe e, em geral, o Stripe só confere o formato: **não é confirmado pelo banco**. Ele impede o engano e o depósito de terceiro comum, mas não um fraudador que digite o CPF de outra pessoa. Por isso o sistema mantém as outras travas (retenção de 72 h, giro obrigatório, pontuação de risco, liberação do admin em todo saque, saque só para o CPF do titular verificado) e você deve **conferir no painel do Stripe os primeiros depósitos** (nome do pagador) e manter limites baixos.
- **Pedido de CPF.** Não consegui confirmar se o Stripe aceita pedir o CPF (`tax_id_collection`) numa sessão só com Pix, nem se o CPF digitado volta no campo que o sistema lê (`customer_details.tax_ids`, tipo `br_cpf`). Se o Stripe **recusar** a criação do Pix por causa disso, coloque `STRIPE_PIX_COLLECT_TAX_ID="false"` no `.env`; se o CPF **não voltar**, todos os depósitos ficam em **Admin → Depósitos retidos** para você conferir no painel do Stripe e liberar. Nos dois casos nada é creditado sem a sua conferência.
- **Reembolso parcial.** Qualquer reembolso ou contestação retira o depósito **inteiro** e congela a carteira; se foi parcial, o admin corrige a diferença com um ajuste (Admin → Carteiras → Ajuste manual).
- **Versão da API.** O sistema fixa a versão `2025-09-30.clover` da API do Stripe (cabeçalho `Stripe-Version`) para que mudanças na sua conta não alterem o comportamento em silêncio.
- **Pix expirado.** O depósito aparece como *Expirado*; se o Stripe ainda confirmar um pagamento tardio, ele é creditado pelo caminho normal.

### 10.7 Se algo der errado (Stripe)

| Sintoma | Verifique |
|---|---|
| "O provedor de pagamentos recusou…" ao gerar o Pix | O terminal mostra `[stripe-pix] POST /checkout/sessions → <código> <tipo> <erro>`. Pix ativado na conta? Chave certa para o modo (teste ou real)? Se o erro citar `tax_id_collection`, use `STRIPE_PIX_COLLECT_TAX_ID="false"`. |
| Pagou e o saldo não subiu | Os eventos do webhook estão marcados (10.3, passo 2) e o endpoint mostra resposta 200? O `STRIPE_WEBHOOK_SECRET` é o do endpoint certo (teste ≠ real)? O depósito pode estar em **Depósitos retidos**. O agendador também reconsulta Pix pagos cujo aviso se perdeu. |
| Todo depósito fica retido | O CPF do pagador não está voltando ou é diferente do titular (10.6). Confira no painel do Stripe e libere em **Depósitos retidos**. |
| Saque "Aguardando pagamento" parado | É o esperado no Stripe: um admin precisa pagar (10.5). Veja **Admin → Saques → Para pagar à mão**. |

**Fontes (resumos de busca, confirme no site):** [Stripe Pix: aceitar um pagamento](https://docs.stripe.com/payments/pix/accept-a-payment) · [Coletar documentos fiscais no Checkout](https://docs.stripe.com/tax/checkout/tax-ids) · [Versões da API](https://docs.stripe.com/api/versioning).
