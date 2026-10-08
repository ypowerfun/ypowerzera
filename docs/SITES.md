# Prime Arena no ChatGPT Sites (Cloudflare Workers + banco D1)

Este guia coloca o site no **ChatGPT Sites**, a hospedagem da OpenAI. O projeto continua funcionando também em servidor próprio (veja `HOSPEDAGEM.md`): o **mesmo código** tem dois modos, e o do Sites é montado por um comando próprio (`npm run build:sites`).

> **Leia primeiro (honestidade):** o site foi montado e testado **no seu equivalente local** (o motor do Cloudflare Workers, `workerd`, com um banco D1 de verdade), inclusive cadastro, login e as 684 provas automáticas rodando contra o D1. **Mas ele nunca foi publicado no ChatGPT Sites de verdade**: a documentação técnica do Sites não pôde ser consultada neste desenvolvimento. Por isso o primeiro passo é pedir ao próprio ChatGPT/Codex que confira a compatibilidade (o prompt pronto está em [`PROMPT_PARA_O_CHATGPT.md`](../PROMPT_PARA_O_CHATGPT.md)). Veja a seção 9 (limites e riscos).

---

## 1. O que muda em relação ao servidor próprio

| Assunto | Servidor próprio (Docker) | ChatGPT Sites |
|---|---|---|
| Banco de dados | SQLite em arquivo | **D1** (SQLite da Cloudflare) |
| Transações do banco | do próprio Prisma/SQLite | **motor próprio** (`src/lib/d1-engine.ts`): o D1 não tem transações, então o site usa uma *trava de escrita* e um *diário de desfazer* gravados no banco (seção 2) |
| E-mail | SMTP, Resend ou Brevo | **somente API** (Resend ou Brevo): o Sites não abre conexões SMTP |
| Agendador (saques, Pix expirado, desafios) | contêiner `cron` a cada 2 min | **Cron Trigger** do Cloudflare, ou um serviço externo que chama o site (seção 5) |
| Senhas/segredos | arquivo `.env` | **secrets** nas configurações do site (nunca em arquivo) |
| HTTPS e domínio | Caddy automático | do próprio Sites (seção 4) |
| Depósitos pela carteira (Fase 2) | Pix via Asaas **ou Stripe** | Pix via **Stripe** (seção 6) |

O que **não** muda: as regras de campeonato, contas, carteira, saques, desafios, as proteções de segurança e a interface.

## 2. Como o dinheiro continua "centavo por centavo" sem transações no D1

O D1 grava cada comando na hora e **não tem `BEGIN/COMMIT`**. Todo o dinheiro do site foi escrito em cima de transações (ex.: "debitar o saldo **e** registrar o saque, ou nada"). Para manter essa garantia, o site traz um motor (`src/lib/d1-engine.ts`) que funciona assim:

1. **Uma trava global de escrita** (uma linha no banco). Só uma transação, ou escrita avulsa, roda por vez; as outras esperam alguns instantes. É o mesmo modelo do SQLite com um escritor só, para o qual o projeto foi desenhado.
2. **Diário de desfazer.** Antes de cada escrita dentro de uma transação, o site grava no banco "como era antes". Se algo falhar, tudo é desfeito na ordem inversa.
3. **Confirmar = apagar o diário e soltar a trava**, em um único passo atômico do D1.
4. **Queda no meio.** Se o servidor morrer no meio (energia, Worker encerrado), a trava vence sozinha em 40 segundos e a **próxima** operação desfaz a transação inacabada antes de qualquer coisa. Se desfazer falhar 5 vezes seguidas, o diário vai para a tabela `_JournalDead` (quarentena) e o erro aparece no log, para o site não ficar travado; a **conciliação** em *Admin → Carteiras* acusa qualquer divergência de dinheiro.

Testado com: erro no meio de transações, cascatas de exclusão, colunas JSON e datas, 10 saques simultâneos (o saldo nunca fica negativo), webhooks repetidos, queda simulada em 3 pontos, trava perdida por demora.

**O que isso não é:** um banco com transações de verdade. Duas consequências práticas: (a) leituras feitas *fora* de uma transação podem ver, por instantes, algo que ainda vai ser desfeito (todas as decisões de dinheiro são tomadas *dentro* da transação, já protegidas); (b) todas as escritas passam por uma fila única, então o site é pensado para **movimento pequeno ou médio** (dezenas de escritas por segundo, não milhares).

## 3. Antes de começar

- Plano do ChatGPT que permita publicar no **Sites** (a OpenAI exige plano pago; confira as regras e a disponibilidade na sua região em [help.openai.com](https://help.openai.com), pois mudam).
- Um **domínio** seu (o Sites não registra domínio; você aponta o DNS para onde ele mandar).
- Uma conta no **Resend** (ou Brevo) com o domínio verificado: `CONFIGURAR_EMAIL.md`, seção 4B.
- Para a **Fase 2** (carteira e desafios com dinheiro): conta **Stripe** com Pix ativado e uma consulta jurídica (`CONFIGURAR_PIX.md` e `SEGURANCA.md`).
- Um **gerenciador de senhas** para guardar `DATA_ENCRYPTION_KEY` e os demais segredos fora do ChatGPT.

## 4. Passo a passo

1. **Gere os segredos** no seu computador (com Node instalado): `npm run secrets`. Guarde o resultado no gerenciador de senhas. **Não cole segredos numa conversa**; eles vão só nas configurações do site, como *secrets*.
2. **Abra uma conversa com o ChatGPT (Codex) com acesso ao projeto**, anexe o zip e cole o texto de [`PROMPT_PARA_O_CHATGPT.md`](../PROMPT_PARA_O_CHATGPT.md). Ele deve: montar com `npm run build:sites`, criar o banco **D1 com o nome de binding `DB`**, aplicar as migrações da pasta `migrations/` **em ordem** (`0001_prime_arena.sql` e `0002_d1_engine.sql`) e publicar.
3. **Cadastre as variáveis** nas configurações do site (tabela abaixo). As marcadas *secret* nunca vão em arquivo.
4. **Conecte o domínio** nas configurações do site e crie os registros DNS que o Sites mostrar.
5. **Primeiro acesso:** abra o site, vá em **Criar conta** com o e-mail que você colocou em `ADMIN_EMAILS`, confirme pelo e-mail, e crie a senha (a conta vira administradora). Depois rode a *Verificação do site* em **Admin → Configurações** (tudo ✔).
6. **Teste o e-mail** (botão em Admin → Configurações) e crie uma conta de teste.

### Variáveis (nas configurações do site)

| Variável | Tipo | Obrigatória | Valor |
|---|---|---|---|
| `APP_URL` | normal | sim | `https://seudominio.com.br` (os links dos e-mails usam isto) |
| `APP_SECRET` | **secret** | sim | 32+ caracteres aleatórios (`npm run secrets`) |
| `ADMIN_EMAILS` | normal | sim | seu e-mail (vira administrador depois de confirmado) |
| `MAIL_FROM` | normal | sim | `Prime Arena <nao-responda@seudominio.com.br>` |
| `RESEND_API_KEY` ou `BREVO_API_KEY` | **secret** | sim | chave da API de e-mail |
| `CRON_SECRET` | **secret** | para o agendador | 24+ caracteres aleatórios |
| `DATA_ENCRYPTION_KEY` | **secret** | Fase 2 | 32 bytes (hex/base64). **Nunca troque com o site no ar**: ele protege os CPFs |
| `PA_RUNTIME` | normal | sim | `sites` (já vem no `wrangler.jsonc`) |
| `PAYMENTS_PROVIDER` | normal | — | `none` na Fase 1 (campeonatos grátis) |
| `WALLET_ENABLED` | normal | — | `false` na Fase 1 |

Binding do banco: **`DB`** (D1). Sem ele o site responde um erro dizendo exatamente isso.

## 5. Agendador

O site precisa de uma chamada periódica (a cada 2 a 5 minutos) para: pagar saques aprovados, expirar Pix e reservas, resolver desafios e conciliar o dinheiro. Duas formas:

1. **Cron Trigger do Cloudflare** (já configurado em `wrangler.jsonc`: `*/2 * * * *`, tratado por `worker.ts`). Só funciona se o Sites aceitar cron; peça ao ChatGPT para confirmar.
2. **Serviço externo** (cron-job.org, GitHub Actions, UptimeRobot…) chamando a cada 2–5 min:
   `POST https://seudominio.com.br/api/cron/wallet` com o cabeçalho `Authorization: Bearer SEU_CRON_SECRET`.

Conferência: **Admin → Configurações → Verificação do site → Agendador** mostra "Rodou há X minutos". Na Fase 1 (sem dinheiro) o agendador ainda limpa sessões e links vencidos.

## 6. Fase 2: depósitos pela carteira com o Stripe

*(Esta seção é completada junto com o módulo Stripe; veja também `CONFIGURAR_PIX.md`.)*

## 7. Levar dados de um banco existente para o D1

Se você já tem um banco SQLite do Prime Arena (servidor próprio ou desenvolvimento) e quer levá-lo para o Sites:

```bash
npm run export:d1 -- --db caminho/do/banco.db --out dados-d1.sql
npx wrangler d1 execute primearena --remote --file dados-d1.sql
```

O exportador só lê o banco de origem, põe os pais antes dos filhos, **converte as datas** para o formato do D1 (texto ISO; misturar com milissegundos quebraria as comparações de data) e **recusa contas de demonstração**. O arquivo gerado tem dados pessoais (CPFs continuam cifrados): apague-o depois.

> **Importante:** se o seu site atual no Sites (por exemplo `primearena1.com.br`) foi gerado de outro projeto, as tabelas dele provavelmente são diferentes destas, e os dados **não** entram automaticamente. Mantenha-o no ar com os dados dele até decidir a migração; este projeto não mexe nele.

## 8. Testar no seu computador

- `npm run preview:sites`: monta o site, cria um banco D1 local e abre em `http://localhost:8787` (o e-mail não sai de verdade).
- `npm run smoke:sites`: sobe o site montado, cadastra uma conta num navegador real, entra, abre a área da conta e confere o agendador (16 verificações).
- `npm run test:d1`: roda **toda** a suíte de testes contra um D1 simulado, com o motor de transações do Sites.

## 9. Limites e riscos (leia)

| Risco | Detalhe | O que fazer |
|---|---|---|
| **Nunca publicado de verdade** | Testado em simulação local do Cloudflare, não no Sites real. O formato do arquivo de ligação com o Sites (`.openai/hosting.json`) não pôde ser consultado, por isso não vem incluído. | Use o prompt pronto: o ChatGPT gera/ajusta a ligação com o Sites e diz o que faltar. Teste tudo com a Fase 1 antes de qualquer dinheiro. |
| **Limites do plano do Sites/Workers** | A hospedagem limita tempo de CPU por pedido, número de consultas ao banco por pedido e tamanho do site. O hash de senha (scrypt) gasta bastante CPU; o agendador faz muitas consultas. | Se cadastro/login falharem por tempo, ou o agendador ficar incompleto, o plano é pequeno demais: confirme os limites com a OpenAI. Em último caso use o servidor próprio. |
| **Fila única de escrita** | Todas as escritas passam por uma trava global. | Adequado a movimento pequeno/médio. Muitos usuários simultâneos pedem servidor próprio com Postgres. |
| **Regras de uso da OpenAI** | Hospedagens podem proibir apostas/jogos de azar e processamento de pagamentos. Desafios com dinheiro entre jogadores podem se enquadrar. | Leia a política do Sites e consulte um advogado **antes** da Fase 2. A Fase 1 (campeonatos gratuitos) não tem esse risco. |
| **Saques manuais no Stripe** | O Stripe recebe Pix, mas não paga Pix a terceiros. | Os saques viram "pagar manualmente e marcar como pago" no painel (seção 6). |
| **Sem 2º fator para admin e sem CAPTCHA** | Igual ao servidor próprio (`SEGURANCA.md`). | Proteja o e-mail do administrador com 2º fator. |
| **Backup** | O banco D1 fica na Cloudflare. | Exporte periodicamente: `npx wrangler d1 export primearena --remote --output backup.sql` e guarde fora. |

## 10. Atualizações do banco no futuro

Mudou o esquema (`prisma/schema.prisma`)? Gere uma nova migração para o D1 e aplique em ordem:

```bash
npx prisma migrate diff --from-schema-datamodel esquema-antigo.prisma --to-schema-datamodel prisma/schema.prisma --script > migrations/0003_descricao.sql
npx wrangler d1 migrations apply primearena --remote
npm run generate:meta && npm run generate:d1
```

(O arquivo `src/lib/model-meta.generated.ts` e o cliente `src/generated/prisma-d1` precisam ser regerados; há um teste que acusa se ficarem desatualizados.)

## 11. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Todas as páginas dão erro 500 e o log fala em "Configuração de produção inválida" | Falta alguma variável da seção 4; a mensagem diz qual |
| "O banco D1 (binding DB) não está configurado" | O binding do D1 não se chama `DB` ou não foi ligado ao site |
| "O sistema está ocupado no momento" | Muitas escritas ao mesmo tempo, ou uma queda recente; tente de novo em segundos |
| E-mails não chegam | `CONFIGURAR_EMAIL.md`, seções 4B e 7 |
| Saques/Pix não andam | Agendador parado (seção 5) |
