# Texto para colar no ChatGPT (Codex) junto com o projeto

> **Como usar**
> 1. Abra uma conversa do ChatGPT/Codex que consiga **rodar comandos** (npm, wrangler) e anexe **SOMENTE o arquivo `.zip`** deste projeto (o `prime-arena-AAAA-MM-DD-….zip`; confira o `VERSAO.txt` dentro dele). **Nunca anexe a pasta de trabalho**: ela pode ter `.env`, `.dev.vars` e bancos de teste com senhas.
> 2. **Preencha o bloco "MEUS DADOS"** (só os dados que não são segredo) e cole **tudo o que está dentro da caixa**.
> 3. **Nunca cole senhas, chaves de API, o `.env` nem a saída do `npm run secrets` na conversa.** Os segredos você digita só nas configurações do site, quando o ChatGPT disser onde.
> 4. O texto manda o ChatGPT **parar e esperar** você nos pontos marcados `[PARE]`. Se ele passar direto por um `[PARE]`, mande: "Pare. Você pulou uma pausa. Volte ao ponto anterior."

```text
Você vai me ajudar a publicar o projeto anexado ("Prime Arena", gerenciador de campeonatos de esports, Next.js 16) no ChatGPT Sites. Eu NÃO sou programador: explique em português simples, um passo de cada vez. Pare nos pontos marcados [PARE] e espere a minha resposta.

NUNCA FINJA: se você não conseguiu executar um comando, escreva "NÃO EXECUTEI" e o motivo. Não diga que algo passou sem mostrar a saída. Se a documentação atual do ChatGPT Sites não estiver acessível, diga isso. NÃO invente formatos de arquivo nem nomes de botões.

MEUS DADOS (use exatamente; se faltar algum, pergunte, nunca invente):
- Endereço do site NOVO: https://______________
- E-mail do administrador (ADMIN_EMAILS): ______________
- Remetente dos e-mails (MAIL_FROM): Prime Arena <nao-responda@______________>
- Provedor de e-mail por API: Resend  (RESEND_API_KEY)
- Nome do site NOVO no Sites: ______________ (NÃO é o site que já existe)

ANTES DE MUDAR QUALQUER COISA (só responda):
A. Leia AGENTS.md, docs/SITES.md e docs/SEGURANCA.md. Rode `npm install` antes de consultar node_modules/next/dist/docs/.
B. Responda: (1) o Sites aceita este projeto (Next.js em Cloudflare Workers + banco D1, via OpenNext, com wrangler.jsonc e worker.ts)? Qual é o jeito ATUAL de publicar? (2) O banco D1 fica numa conta MINHA ou da OpenAI? Como eu faço e restauro uma cópia de segurança? (3) Onde eu digito segredos na interface do Sites? Descreva os passos SEM eu colar valor nenhum aqui. Se o único jeito for colar no chat, PARE e me avise. (4) O Sites aceita Cron Trigger (docs/SITES.md seção 5)? (5) Quais os limites do meu plano: tempo de CPU por pedido (o hash de senha usa scrypt), consultas ao banco por pedido, tamanho do site (o Worker montado tem ~15,5 MiB, ~3,9 MiB comprimido) e restrições de conteúdo (campeonatos grátis agora; dinheiro só depois)? (6) O Sites lê as `vars` do wrangler.jsonc ou ignora esse arquivo? (7) O cabeçalho cf-connecting-ip é SEMPRE definido pela hospedagem e o visitante não consegue enviá-lo? (o site o usa para limitar tentativas de senha; se não puder confirmar, diga). [PARE: espere meu "ok"]

DEPOIS, NESTA ORDEM:
1. Monte: `npm install` e `npm run build:sites` (nunca `next build` sozinho). Se existir .env, .env.local ou .dev.vars na pasta, APAGUE (não são meus). NUNCA use PA_ALLOW_ENV_FILE=1.
2. Rode e mostre a saída completa de: npm run typecheck; npm test; npm run test:d1; npm run smoke:sites (se o ambiente permitir; senão escreva "NÃO EXECUTEI"). Se algo falhar, mostre o erro e PARE. Não altere testes nem "contorne".
3. Crie um banco D1 NOVO e VAZIO chamado `primearena` (binding `DB`). Troque o database_id de exemplo ("COLOQUE-AQUI-O-ID-DO-BANCO-D1") em wrangler.jsonc pelo ID real e me diga o nome final do banco (os comandos de backup dos guias usam esse nome). Aplique TODAS as migrações, em ordem, no banco REMOTO (`npx wrangler d1 migrations apply primearena --remote` ou o equivalente do Sites): 0001_prime_arena.sql e 0002_d1_engine.sql. Prove com `SELECT name FROM sqlite_master WHERE type='table'`: devem existir User, _Lease, _Journal e _JournalDead. Aplicar só no banco local NÃO conta. NÃO use prisma db push, prisma migrate, npm run setup, db:seed nem reset.
4. Gere a ligação com o Sites do jeito que a documentação ATUAL pedir e me mostre o que criou ou alterou.
5. Configure só as variáveis NORMAIS (tabela da seção 4 de docs/SITES.md) com os MEUS DADOS: APP_URL, ADMIN_EMAILS, MAIL_FROM. PA_RUNTIME=sites, PAYMENTS_PROVIDER=none e WALLET_ENABLED=false já estão no bloco `vars` do wrangler.jsonc: se o Sites LÊ esse arquivo, NÃO as cadastre de novo; se o Sites o ignora, cadastre-as como variáveis normais (nunca como segredo, nunca nos dois lugares). Os SEGREDOS (APP_SECRET, CRON_SECRET, RESEND_API_KEY) EU cadastro: liste o nome de cada um e o passo exato de onde digitar. Não gere, peça, receba nem repita segredos no chat.
6. Publique como VERSÃO DE REVISÃO (não pública), se o Sites tiver isso. Se não tiver, PARE e me avise ANTES de publicar. Mostre o endereço. [PARE: só publique de verdade depois que eu escrever exatamente "PODE PUBLICAR"]
7. Depois: abra o site e confirme que o menu NÃO mostra "Carteira" nem "Desafios". Se aparecer "Serviço indisponível", leia o log, diga QUAL variável falta (só o nome, nunca o valor) e pare. Rode `npm run verificar-site -- https://ENDEREÇO` e mostre o resultado.
8. Termine com 3 listas: FEITO / FALTA EU FAZER (domínio e DNS, segredos, verificação do domínio do e-mail, criar a conta de administrador) / RISCOS e o que você NÃO conseguiu confirmar.

REGRAS QUE NÃO PODEM SER QUEBRADAS (se achar que precisa quebrar uma, PARE e pergunte; não decida sozinho):
- Não altere: src/lib/d1-engine.ts, src/lib/db.d1.ts, src/lib/model-meta.generated.ts, src/generated/, migrations/ (pode ADICIONAR arquivos novos, nunca editar os existentes), next.config.ts, open-next.config.ts, scripts/next-build-sites.mjs, src/lib/env.ts, src/server/boot-guard.ts, a parte "gate" do worker.ts, src/server/pix/, src/server/withdrawals.ts, src/server/stripe-webhook.ts, nem o hash de senhas (scrypt) em src/lib/crypto.ts e src/server/auth.ts. Se o limite de CPU ou de tamanho do plano for o problema, NÃO troque o algoritmo de senha nem remova proteções: me diga.
- Não habilite carteira nem pagamento de inscrição. Não defina PIX_PROVIDER, STRIPE_*, STRIPE_ALLOW_TEST_KEY, STRIPE_PIX_AUTO_CREDIT, ALLOW_MOCK_PAYMENTS, ALLOW_MOCK_PIX, PA_LOCAL_PREVIEW, PA_ALLOW_ENV_FILE nem variável nenhuma que a tabela do docs/SITES.md não liste.
- Não desligue verificações de segurança (src/lib/env.ts, src/server/boot-guard.ts). Se o site responder 503 por configuração, o certo é corrigir a configuração.
- Não toque no site que já está no ar (primearena1.com.br), nem no domínio ou nos dados dele. Crie um site NOVO com o nome que informei. Antes de QUALQUER publicação ou conexão de domínio, diga qual site e endereço serão criados ou alterados e espere meu OK.
- Não importe dados de outro banco nem rode export:d1.
- Mostre erros completos, sem segredos.
```

## Se o ChatGPT travar

| Situação | O que fazer |
|---|---|
| Ele diz que **não consegue rodar `npm`/`wrangler`** ou que o Sites não aceita este tipo de projeto | Não force. Peça que ele explique, em português, o motivo. Opções: tentar o **Codex** (que trabalha sobre uma pasta ou repositório), pedir a um desenvolvedor, ou usar o **servidor próprio** (`docs/HOSPEDAGEM.md`). |
| A única forma de cadastrar os segredos é **colar no chat** | **Pare.** Não cole. Use o servidor próprio ou espere o Sites oferecer a tela de configurações. |
| Ele quer **alterar um dos arquivos protegidos** | Diga: "Não. Explique o problema e pare." Quem decide é um desenvolvedor de confiança, não o ChatGPT. |
| O site mostra **"Serviço indisponível"** | Falta ou está errada alguma variável. Peça: "Leia o log e me diga QUAL variável falta (só o nome)". Nunca ligue `ALLOW_MOCK_*`, `PA_LOCAL_PREVIEW` ou `PA_ALLOW_ENV_FILE` para "fazer funcionar". |
