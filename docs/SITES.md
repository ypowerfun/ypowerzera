# Prime Arena no ChatGPT Sites (Cloudflare Workers + banco D1)

Este guia coloca o site no **ChatGPT Sites**, a hospedagem da OpenAI. O projeto continua podendo rodar em servidor próprio (`HOSPEDAGEM.md`): o **mesmo código** tem dois modos, e o do Sites é montado por um comando próprio (`npm run build:sites`).

> **Leia primeiro (honestidade).** O site foi montado e testado **no seu equivalente local**: o motor do Cloudflare Workers (`workerd`) com um banco D1 **simulado** (Miniflare). Nele rodaram o cadastro, o login, as páginas públicas e o agendador **no Worker montado** (`npm run smoke:sites`, 21 verificações) e a suíte de testes de dados e de negócio (658 testes; fica de fora só o instalador de servidor, o reset do banco local e os testes do próprio motor, que rodam no `npm test`) contra esse D1 simulado. Campeonatos, times, inscrições e dinheiro foram provados **nessa suíte** (em Node + D1 simulado), **não** executados dentro do Worker montado.
>
> **Ele nunca foi publicado no ChatGPT Sites de verdade.** A documentação técnica do Sites não pôde ser consultada neste desenvolvimento, e por isso o arquivo de ligação com o Sites (`.openai/hosting.json`) **não** vem incluído. O primeiro passo é pedir ao próprio ChatGPT/Codex que confira a compatibilidade (texto pronto em [`PROMPT_PARA_O_CHATGPT.md`](../PROMPT_PARA_O_CHATGPT.md)). Veja a seção 9 (limites e riscos) antes de apostar nisto.

---

## 1. O que muda em relação ao servidor próprio

| Assunto | Servidor próprio (Docker) | ChatGPT Sites |
|---|---|---|
| Banco de dados | SQLite em arquivo | **D1** (SQLite da Cloudflare) |
| Transações do banco | do próprio Prisma/SQLite | **motor próprio** (`src/lib/d1-engine.ts`): o D1 não tem transações, então o site usa uma *trava de escrita* e um *diário de desfazer* gravados no banco (seção 2 e Apêndice A) |
| E-mail | SMTP, Resend ou Brevo | **somente API** (use o **Resend**): o Sites não abre conexões SMTP |
| Agendador (saques, Pix expirado, desafios) | contêiner `cron` a cada 2 min | **Cron Trigger** do Cloudflare, ou um serviço externo que chama o site (seção 5) |
| Senhas/segredos | arquivo `.env` | **segredos** nas configurações do site (nunca em arquivo) |
| HTTPS e domínio | Caddy automático | do próprio Sites (seção 4) |
| Depósitos pela carteira (Fase 2) | Pix via Asaas **ou Stripe** | Pix via **Stripe** (seção 6) |

O que **não** muda: as regras de campeonato, contas, carteira, saques, desafios, as proteções de segurança e a interface.

## 2. O dinheiro continua "centavo por centavo"?

O D1 não tem transações de verdade ("faça tudo ou nada"). O site contorna isso com um motor próprio: **uma fila única de escrita**, um **diário de desfazer** gravado no banco e uma **recuperação automática** se o Worker morrer no meio. A conciliação em *Admin → Carteiras* acusa qualquer divergência de dinheiro, e *Admin → Configurações → Verificação do site → "Banco do Sites (transações)"* mostra se sobrou algo a desfazer.

Isto é uma solução de engenharia, **não** um banco com transações: tem limites conhecidos (por exemplo, é pensada para movimento pequeno ou médio) e o seu desempenho no D1 real **não foi medido**. Os detalhes técnicos e os limites estão no **Apêndice A**, no fim. Você não precisa lê-los para seguir o passo a passo, mas **precisa** ler a seção 9 antes da Fase 2.

## 3. Antes de começar

- **O seu plano do ChatGPT precisa permitir publicar no Sites.** Provavelmente é preciso um plano pago; confirme as regras e a disponibilidade na sua região em [help.openai.com](https://help.openai.com), pois mudam.
- **O site montado é grande:** cerca de 15,5 MiB (≈ 3,9 MiB comprimido). Pergunte à OpenAI se o seu plano aceita um site desse tamanho (a Cloudflare, por exemplo, limita a 3 MiB comprimidos no plano gratuito dela e a 10 MiB no pago).
- Um **domínio** seu (o Sites não registra domínio; você aponta o DNS para onde ele mandar).
- Uma conta no **Resend** com o domínio **verificado** (aparece "Verified"): `CONFIGURAR_EMAIL.md`, seção 4B. Isso pode levar horas: comece por aí.
- Um **gerenciador de senhas** (1Password, Bitwarden etc.) para guardar os segredos **fora** do ChatGPT. Node/terminal são opcionais (só para `npm run secrets -- --sites` e `npm run verificar-site`).
- Para a **Fase 2** (carteira e desafios com dinheiro): conta **Stripe** com Pix ativado, uma consulta jurídica (`CONFIGURAR_PIX.md` e `SEGURANCA.md`) e um **backup do banco que você consiga restaurar** (seção 9).
- Se for rodar os comandos do computador (seção 8): Linux ou macOS. No Windows use o **WSL**.

### Palavras que aparecem aqui

- **Segredo (secret):** senha ou chave que fica **escondida depois de salva**. Nunca vai em arquivo nem em conversa.
- **Variável normal:** configuração visível, como o endereço do site.
- **D1:** o banco de dados do Cloudflare onde ficam contas, campeonatos e carteira.
- **Binding `DB`:** o nome que liga o site ao banco; tem de ser exatamente `DB`.
- **Migração:** arquivo que cria as tabelas do banco; precisa ser aplicada em ordem.
- **Agendador (cron):** um relógio que chama o site a cada 2 minutos para pagar saques, expirar Pix e limpar sessões.
- **Webhook:** aviso automático que o Stripe manda ao seu site quando alguém paga.
- **Versão de revisão:** cópia do site que só você vê, antes de ir ao ar (se o Sites oferecer isso).
- **Pix retido:** depósito que espera um administrador conferir antes de virar crédito.

## 4. Passo a passo

### O que ainda não sabemos (e como reagir)

Estas três perguntas o ChatGPT responde logo no início (o texto pronto já as faz). Se a resposta for ruim, **pare**:

1. **Onde eu digito os segredos?** Se a resposta for "cole aqui no chat", **PARE**: não use essa opção. Use o servidor próprio (`HOSPEDAGEM.md`) ou espere o Sites oferecer uma tela de configurações.
2. **O ChatGPT não aceitou o zip ou não consegue rodar `npm`?** Tente o **Codex** (que trabalha sobre uma pasta ou repositório) ou peça a um desenvolvedor.
3. **O banco D1 fica na SUA conta Cloudflare ou na da OpenAI?** Se for da OpenAI e você não conseguir exportar uma cópia por conta própria, **NÃO ligue a Fase 2**.

### Na ordem

1. **Verifique o domínio do e-mail** no Resend e **espere aparecer "Verified"** (`CONFIGURAR_EMAIL.md`, seções 3 e 4B). Antes disso o Resend só entrega para o seu próprio e-mail.
2. **Gere os segredos.** No seu computador com Node: `npm run secrets -- --sites` (imprime só `APP_SECRET`, `CRON_SECRET` e `DATA_ENCRYPTION_KEY`; **não** crie um arquivo `.env`). **Sem Node:** use o gerador do seu gerenciador de senhas, com 40 caracteres só de letras e números para `APP_SECRET` e `CRON_SECRET`, e 64 caracteres só de letras e números para `DATA_ENCRYPTION_KEY`. Guarde cada um com o nome da variável. **Não peça ao ChatGPT para gerar segredos**: o que ele escreve fica na conversa.
3. **Abra uma conversa com o ChatGPT (Codex)** e anexe **somente o `.zip`** (nunca a pasta de trabalho). **Preencha o bloco "MEUS DADOS"** do texto de [`PROMPT_PARA_O_CHATGPT.md`](../PROMPT_PARA_O_CHATGPT.md) (o endereço do site novo é `https://` + o seu domínio; se for usar o endereço provisório do Sites, pergunte-o ao ChatGPT antes de preencher) e cole o texto inteiro. Ele deve responder às perguntas acima, montar com `npm run build:sites`, rodar os testes, criar o banco D1 `primearena` (binding `DB`), aplicar **em ordem** as migrações `0001_prime_arena.sql` e `0002_d1_engine.sql` **no banco remoto** e **parar** para você.
4. **Conecte o domínio** (ou descubra o endereço provisório que o Sites der) **antes** de fechar o `APP_URL`: ele tem de ser o endereço que o público vai usar, porque vai nos links dos e-mails de confirmação. Crie os registros DNS que o Sites mostrar.
5. **Cadastre as variáveis e os segredos** (tabela abaixo) nas configurações do site. O ChatGPT lista o nome de cada um e diz onde digitar; **você** digita os segredos. (O build para o Sites **recusa** montar se houver um arquivo `.env` na pasta, justamente para que nenhum segredo seja embutido no pacote.)
6. **Publique primeiro a versão de revisão** e confira que as páginas abrem e que **não** aparece "Serviço indisponível" (seção 11). Só então escreva **"PODE PUBLICAR"**.
7. **Crie a conta de administrador logo depois de publicar, antes de divulgar o endereço.** Vá em **Criar conta** com o e-mail que você colocou em `ADMIN_EMAILS`, confirme pelo e-mail e crie a senha (a conta vira administradora). Se o e-mail de confirmação não chegar: corrija a chave ou o remetente e use **Minha conta → Reenviar e-mail de confirmação** (limite de 3 por hora) ou **Esqueci minha senha**.
8. **Admin → Configurações:** clique em **Enviar e-mail de teste para mim** e olhe a **Verificação do site**. Na Fase 1 o item *Agendador* pode ficar vermelho se o Sites não aceitar cron (seção 5); isso não impede campeonatos grátis.
9. **No seu computador (ou peça ao ChatGPT):** `npm run verificar-site -- https://seudominio.com.br`. Todos os itens devem sair ✔.
10. **Confira o checklist abaixo antes de divulgar.**

### Checklist antes de divulgar

- [ ] `verificar-site` todo ✔.
- [ ] O e-mail de teste chegou na sua caixa de entrada.
- [ ] A conta de administrador existe e você consegue entrar.
- [ ] O menu **não** mostra "Carteira" nem "Desafios".
- [ ] Agendador ✔, **ou** você decidiu como chamá-lo (seção 5).
- [ ] Você sabe fazer e **restaurar** um backup do banco (seção 9).
- [ ] Os segredos estão guardados no gerenciador de senhas, fora do ChatGPT.

### Variáveis (nas configurações do site)

*Segredo* = valor escondido depois de salvo (chaves e senhas). *Normal* = valor visível (endereços e liga/desliga).

| Variável | Tipo | Obrigatória | Valor |
|---|---|---|---|
| `APP_URL` | normal | **sim** | `https://seudominio.com.br` (os links dos e-mails usam isto) |
| `APP_SECRET` | **segredo** | **sim** | 32+ caracteres aleatórios |
| `ADMIN_EMAILS` | normal | **sim** | seu e-mail (vira administrador depois de confirmado) |
| `MAIL_FROM` | normal | **sim** | `Prime Arena <nao-responda@seudominio.com.br>` (domínio **Verified** no Resend) |
| `RESEND_API_KEY` | **segredo** | **sim** | chave da API do Resend (o Brevo também é aceito pelo código, mas no Sites só o Resend foi considerado: o Brevo pode exigir IP fixo, que os Workers não têm) |
| `CRON_SECRET` | **segredo** | **sim, sempre** | 24+ caracteres aleatórios. **Sem ele o site responde 503 em todas as páginas, mesmo na Fase 1** |
| `PA_RUNTIME` | normal | recomendada | `sites` (já vem no `wrangler.jsonc`; o site também reconhece sozinho que está no Cloudflare Workers) |
| `PAYMENTS_PROVIDER` | normal | **sim** | `none` (campeonatos grátis). Já vem no `wrangler.jsonc` |
| `WALLET_ENABLED` | normal | **sim** | `false` na Fase 1. Se faltar, o site assume `true` e **não sobe**. Já vem no `wrangler.jsonc` |
| `DATA_ENCRYPTION_KEY` | **segredo** | Fase 2 | gere junto com os outros e guarde. **Nunca troque com o site no ar**: ele protege os CPFs |
| `PA_LOCAL_PREVIEW` | — | **nunca** | só para a prévia no seu computador. Não coloque no site de verdade (o site recusa subir) |

**`wrangler.jsonc` ou configurações do site, nunca os dois:** `PA_RUNTIME`, `PAYMENTS_PROVIDER` e `WALLET_ENABLED` já vêm no arquivo `wrangler.jsonc` (bloco `vars`). Se o ChatGPT disser que o Sites **lê** esse arquivo, deixe-as lá. Se disser que o Sites **ignora** esse arquivo, cadastre-as nas configurações do site, como variáveis normais. **Nunca cadastre como segredo um nome que já está no arquivo**, e confira depois de cada publicação que o valor não voltou ao anterior.

Binding do banco: **`DB`** (D1). Sem ele o site responde o mesmo 503 "Serviço indisponível" da seção 11; a mensagem exata ("O banco D1 (binding DB) não está configurado") só aparece **no log**.

## 5. Agendador

O site precisa de uma chamada periódica (a cada 2 a 5 minutos) para: pagar saques aprovados, expirar Pix e reservas, resolver desafios e conciliar o dinheiro. Duas formas:

1. **Cron Trigger do Cloudflare** (já configurado em `wrangler.jsonc`: `*/2 * * * *`, tratado por `worker.ts`). Só funciona se o Sites aceitar cron; peça ao ChatGPT para confirmar.
2. **Serviço externo** (cron-job.org, GitHub Actions, UptimeRobot…) chamando a cada 2–5 min:
   `POST https://seudominio.com.br/api/cron/wallet` com o cabeçalho `Authorization: Bearer SEU_CRON_SECRET`.
   Esse serviço passará a conhecer o seu `CRON_SECRET`. Use um serviço em que você confia, não reutilize esse segredo em mais nada e, se suspeitar de vazamento, troque-o nas configurações do site.

Conferência: **Admin → Configurações → Verificação do site → Agendador** mostra "Rodou há X minutos". Na Fase 1 (sem dinheiro) o agendador só limpa sessões e links vencidos; **a Fase 2 não deve ser ligada sem ele funcionando.**

## 6. Fase 2: depósitos pela carteira com o Stripe

Com o Sites a carteira usa o **Stripe** (Pix) para receber depósitos. O passo a passo completo, com as variáveis, os eventos do webhook e como testar no modo de teste, está em [`CONFIGURAR_PIX.md`](CONFIGURAR_PIX.md), **seção 10**. O Asaas não é aceito no Sites (o site se recusa a subir com ele).

> ### ⚠️ Antes de ligar: como a Carteira aparece para os usuários
> A Carteira, os depósitos e os **Desafios** aparecem para **todos** os usuários quando duas coisas são verdadeiras ao mesmo tempo: `WALLET_ENABLED=true` **e** o administrador clica em **Admin → Configurações → "Ativar a carteira"** (em produção essa chave **começa desligada**; salvar as variáveis sozinho não expõe o dinheiro). Portanto:
> 1. Tenha o **backup do banco testado** (seção 9) e a **consulta jurídica** com a resposta **por escrito** do Stripe e da OpenAI (`SEGURANCA.md`).
> 2. Salve `WALLET_ENABLED=true` **por último**, depois de todos os outros itens (senão o site fica em 503 enquanto você cadastra um por um).
> 3. **Desligar de emergência:** *Admin → Configurações → "Desativar a carteira"*, ou volte `WALLET_ENABLED` para `false` (no mesmo lugar onde você o mudou, seção 4).

Resumo:

1. No Stripe: ative o **Pix**, crie a chave secreta e um **webhook** em `https://seudominio.com.br/api/webhooks/stripe` com os 6 eventos da seção 10.3 do guia do Pix.
2. **Segredos:** `DATA_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. **Variáveis normais:** `PIX_PROVIDER=stripe` (e, só no site de ensaio, `STRIPE_ALLOW_TEST_KEY=true`) e, por último, `WALLET_ENABLED=true`. Para mudar `WALLET_ENABLED` use **um só lugar**: o `wrangler.jsonc` (peça ao ChatGPT para editar o bloco `vars` e publicar de novo) **ou** as configurações do site, conforme a seção 4.
3. **Todo depósito fica retido** até um administrador conferir o nome do pagador no painel do Stripe (o CPF digitado pelo pagador não é confirmado pelo banco). O crédito automático existe, mas é opcional e mais arriscado (`STRIPE_PIX_AUTO_CREDIT`).
4. **Saques são manuais**: o Stripe recebe Pix, mas não paga Pix a terceiros. O administrador paga no app do banco e registra no painel (um administrador por saque, com comprovante).
5. **Ensaie com chave de teste, mas NUNCA no site com usuários de verdade.** O site trata os créditos de um ensaio como dinheiro real. Faça o ensaio num **site separado**, com banco D1 próprio e vazio, que ninguém conheça, e apague-o ao terminar. `STRIPE_ALLOW_TEST_KEY` é só para esse site de ensaio; nunca a copie para o definitivo. Detalhes e proteções no guia do Pix, seção 10.3.

Nada disso foi testado contra o Stripe de verdade (a documentação oficial não pôde ser aberta no desenvolvimento): a seção 10.6 do guia lista exatamente o que confirmar no modo de teste.

---

## 7. Já tenho um site no ar (primearena1.com.br) ou dados de outro banco

**Este projeto não mexe no site que já está no ar.** O plano seguro para trocar um pelo outro:

1. Publique o projeto **novo** em **outro nome/endereço** (por exemplo `novo.primearena1.com.br` ou o endereço provisório do Sites).
2. Faça nele toda a Fase 1 e a verificação.
3. Só então peça ao ChatGPT para mover o domínio para o site novo, e **avise antes os usuários do site antigo**: as contas e os dados do site antigo **não** são transferidos automaticamente (as tabelas são diferentes).
4. **Não apague o site antigo** antes de ter o novo funcionando por alguns dias.

Se você já tem um banco SQLite do **Prime Arena** deste mesmo projeto (servidor próprio ou desenvolvimento) e quer levá-lo para o Sites (trabalho para um desenvolvedor ou para o ChatGPT):

```bash
npm run export:d1 -- --db caminho/do/banco.db --out dados-d1.sql
npx wrangler d1 execute primearena --remote --file dados-d1.sql
```

O exportador só lê o banco de origem, põe os pais antes dos filhos, **converte as datas** para o formato do D1 (texto ISO; misturar com milissegundos quebraria as comparações de data) e **recusa contas de demonstração**. O arquivo gerado tem dados pessoais (CPFs continuam cifrados): apague-o depois. Faça antes um backup do banco de destino (seção 9). Se o seu site atual do Sites foi gerado de **outro** projeto, as tabelas dele são diferentes e os dados não entram.

## 8. Testar no seu computador

*Estes comandos são para Linux/macOS (no Windows use o WSL) e para quem sabe usar o terminal. O ChatGPT pode rodá-los por você.*

- `npm run preview:sites`: monta o site, cria um banco D1 local e abre em `http://localhost:8787`. O e-mail **não sai de verdade**: o texto da mensagem (com o link de confirmação) aparece **no terminal onde o comando está rodando**; copie o link para o navegador.
- `npm run smoke:sites`: monta o site, sobe o pacote montado, cadastra uma conta num navegador real, entra, abre a área da conta e dispara o agendador (21 verificações; o e-mail é marcado como confirmado direto no banco). Precisa do Chromium do Playwright (`npx playwright install chromium`) e **se recusa a rodar se existir um `.dev.vars`**: o `preview:sites` cria esse arquivo, então apague-o (ou renomeie-o) antes do `smoke:sites`.
- `npm run test:d1`: roda a suíte de testes de dados e de negócio (658; todos menos o instalador de servidor, o reset do banco local e os testes do motor) contra um D1 simulado, com o motor de transações do Sites.
- `npm test`: os testes normais (763), incluindo os do próprio motor (`tests/d1/`). `npm run test:d1:fuzz`: varreduras pesadas do motor (alguns minutos).
- `npm run empacotar`: monta o `.zip` para entregar, só com os arquivos versionados e conferido (sem `.env`, `.dev.vars`, bancos nem `node_modules`).

## 9. Limites e riscos (leia)

| Risco | Detalhe | O que fazer |
|---|---|---|
| **Nunca publicado de verdade** | Testado em simulação local do Cloudflare, não no Sites real. No Worker montado só foram executados cadastro, login, páginas públicas e o agendador; campeonatos e dinheiro foram provados na suíte (Node + D1 simulado). | Use o prompt pronto: o ChatGPT gera/ajusta a ligação com o Sites e diz o que faltar. Teste tudo com a Fase 1 antes de qualquer dinheiro. |
| **Tamanho do site** | O Worker montado tem ~15,5 MiB (≈ 3,9 MiB comprimido). O limite da Cloudflare é 10 MiB comprimido no plano pago e **3 MiB no gratuito**. | Confirme o limite do seu plano do Sites (seção 3). |
| **Limites do plano do Sites/Workers** | A hospedagem limita tempo de CPU por pedido, número de consultas ao banco por pedido e tamanho do site. O hash de senha (scrypt) gasta bastante CPU (≈ 0,26 s medido no computador); o agendador faz muitas consultas. | Se cadastro/login falharem por tempo, ou o agendador ficar incompleto, o plano é pequeno demais: confirme os limites com a OpenAI. Em último caso use o servidor próprio. **Não reduza o custo do hash** (`SEGURANCA.md`). |
| **Fila única de escrita** | Todas as escritas passam por uma trava global; no D1 real o desempenho **não foi medido** (cada transação segura a trava durante várias idas ao banco). | Espere poucas transações por segundo. Adequado a movimento pequeno. Muitos usuários simultâneos pedem servidor próprio com Postgres. |
| **IP do visitante** | O site confia no cabeçalho `cf-connecting-ip` para limitar tentativas de senha. Isso só é seguro se o Sites roda atrás da Cloudflare, que o sobrescreve; **isso não foi confirmado para o ChatGPT Sites**. | Peça ao ChatGPT para confirmar na documentação atual (o texto pronto já pergunta). Se não puder confirmar, não ligue a Fase 2. |
| **Regras de uso da OpenAI** | Hospedagens podem proibir apostas/jogos de azar e processamento de pagamentos. Desafios com dinheiro entre jogadores podem se enquadrar. | Leia a política do Sites e consulte um advogado **antes** da Fase 2. A Fase 1 (campeonatos gratuitos) não tem esse risco. |
| **Saques manuais no Stripe** | O Stripe recebe Pix, mas não paga Pix a terceiros. | Os saques viram "pagar manualmente e marcar como pago" no painel (seção 6). |
| **Sem 2º fator para admin e sem CAPTCHA** | Igual ao servidor próprio (`SEGURANCA.md`). | Proteja o e-mail do administrador com 2º fator. |
| **Backup (confirme ANTES da Fase 2)** | O banco D1 pode estar na sua conta Cloudflare **ou** na da OpenAI; você pode não ter acesso ao `wrangler`. | Pergunte ao ChatGPT: *"O banco D1 fica na minha conta Cloudflare ou na da OpenAI? Como eu exporto uma cópia completa e como restauro?"* Se não houver uma forma que **você** consiga usar sozinho, **NÃO ligue a Fase 2**. Se houver: `npx wrangler d1 export primearena --remote --output backup.sql`. Faça uma cópia antes de qualquer atualização do banco e guarde-a **fora** do ChatGPT, junto com a `DATA_ENCRYPTION_KEY`. |

### Como restaurar um backup (e por que testar antes de precisar)

Um arquivo `backup.sql` do `d1 export` traz `CREATE TABLE` e os dados: **ele não se reaplica sobre um banco que já tem as tabelas**. Restaurar é criar um banco novo: (1) crie um banco D1 **novo e vazio**; (2) `npx wrangler d1 execute NOME-DO-BANCO-NOVO --remote --file backup.sql`; (3) troque o `database_id` (e o nome) no `wrangler.jsonc` pelo do banco novo e publique de novo; (4) confira o resultado (por exemplo, o número de contas e a **conciliação** em *Admin → Carteiras*). O Cloudflare também tem recuperação do D1 a um momento anterior ("Time Travel"); confirme se existe no seu plano. **Este procedimento nunca foi testado aqui**: ensaie-o num banco de teste **antes** da Fase 2, e só marque o item do checklist depois de conseguir.

## 10. Atualizações do banco no futuro

*Isto é trabalho para um desenvolvedor ou para o ChatGPT, não para você. Peça: "gere a migração 0003, aplique primeiro num banco de teste e só depois no real, depois de eu ter uma cópia de segurança." **Nunca aplique migração sem backup**: migrações do Prisma que recriam tabelas podem apagar linhas filhas por causa das chaves estrangeiras do D1; leia o `.sql` gerado antes de aplicar.*

Mudou o esquema (`prisma/schema.prisma`)? Guarde o antigo **antes** de editar (`git show HEAD:prisma/schema.prisma > esquema-antigo.prisma`), gere a nova migração para o D1 e aplique em ordem:

```bash
npx prisma migrate diff --from-schema-datamodel esquema-antigo.prisma --to-schema-datamodel prisma/schema.prisma --script > migrations/0003_descricao.sql
npx wrangler d1 export primearena --remote --output antes.sql
npx wrangler d1 migrations apply primearena --remote
npx prisma generate && npm run generate:meta && npm run generate:d1
```

O arquivo `src/lib/model-meta.generated.ts` e o cliente `src/generated/prisma-d1` precisam ser regerados. O teste `tests/model-meta.test.ts` acusa se o primeiro ficar desatualizado (`node scripts/gen-model-meta.mjs --check`).

## 11. Problemas comuns

| Sintoma | Causa provável e o que fazer |
|---|---|
| Todas as páginas mostram **"Serviço indisponível: a configuração do site está incompleta ou insegura"** (erro 503) | Falta ou está errada alguma variável da tabela da seção 4. O motivo fica **só no log** do site (`[boot-guard] BLOQUEADO: Configuração de produção inválida…`). Peça ao ChatGPT: *"leia o log de erros do site e me diga QUAL variável falta (só o nome, nunca o valor)"*. **Nunca** ligue `ALLOW_MOCK_PAYMENTS`, `ALLOW_MOCK_PIX`, `PA_LOCAL_PREVIEW` nem `PA_ALLOW_ENV_FILE` para "fazer funcionar". |
| No **log** aparece "O banco D1 (binding DB) não está configurado" (para o visitante é o mesmo 503) | O binding do D1 não se chama `DB` ou não foi ligado ao site |
| "O sistema está ocupado no momento" | Muitas escritas ao mesmo tempo, ou uma queda recente; tente de novo em segundos |
| E-mails não chegam | `CONFIGURAR_EMAIL.md`, seções 4B e 7. Confira se o Resend mostra o domínio como **Verified** |
| O e-mail de confirmação do administrador não chega | Corrija a chave ou o remetente e use **Minha conta → Reenviar e-mail de confirmação** ou **Esqueci minha senha** |
| Cadastro e login funcionam na prévia do seu computador, mas dão erro ou demoram só no site real | Limite de tempo de CPU do plano (o hash de senha é caro de propósito; erro tipo "exceeded CPU time limit"). Peça ao ChatGPT o log e o limite do plano. **Não reduza o custo do hash.** Mude de plano ou use o servidor próprio |
| Saques/Pix não andam | Agendador parado (seção 5) |

---

## Apêndice A. Para quem quer entender: como o dinheiro fica "tudo ou nada" sem transações no D1

O D1 grava cada comando na hora e **não tem `BEGIN/COMMIT`**. Todo o dinheiro do site foi escrito em cima de transações (ex.: "debitar o saldo **e** registrar o saque, ou nada"). Para manter essa garantia, o site traz um motor (`src/lib/d1-engine.ts`) que funciona assim:

1. **Uma trava global de escrita** (uma linha no banco). Só uma transação, ou escrita avulsa, roda por vez; as outras esperam alguns instantes. É o mesmo modelo do SQLite com um escritor só, para o qual o projeto foi desenhado.
2. **Diário de desfazer.** Antes de cada escrita dentro de uma transação, o site grava no banco "como era antes". Se algo falhar, tudo é desfeito na ordem inversa.
3. **Confirmar = apagar o diário e soltar a trava**, em um único passo atômico do D1.
4. **Queda no meio.** Se o servidor morrer no meio (energia, Worker encerrado), a trava vence sozinha em 40 segundos e a **próxima** operação desfaz a transação inacabada antes de qualquer coisa. Se desfazer falhar 5 vezes seguidas, o diário vai para a tabela `_JournalDead` (quarentena) e o erro aparece no log, para o site não ficar travado. **Admin → Configurações → Verificação do site → "Banco do Sites (transações)"** mostra a quarentena e qualquer transação interrompida; a **conciliação** em *Admin → Carteiras* acusa qualquer divergência de dinheiro.

Testado (na suíte contra o D1 simulado) com: erro no meio de transações, cascatas de exclusão, colunas JSON e datas, 10 saques simultâneos (o saldo nunca fica negativo), webhooks repetidos, queda simulada em 3 pontos, trava perdida por demora.

**Limites conhecidos do motor (documentados nos testes `tests/d1/engine-*.test.ts`, marcados `it.fails`):**
- uma **única** chamada ao D1 que ficasse parada por mais de 40 segundos exatamente entre a conferência da trava e a gravação poderia deixar metade de uma transação; **o mesmo vale durante o desfazer**: se o próprio desfazer ficar parado mais de 40 segundos, ele pode sobrescrever algo que outra operação gravou e confirmou depois (teste ATK-6). A chance é baixa, mas **não foi medida no D1 real**;
- `Prisma.JsonNull` explícito numa coluna JSON opcional voltaria como `NULL` ao desfazer (o site só usa `Prisma.DbNull`);
- SQL cru (`$executeRaw`) é recusado dentro de transação; escrita aninhada (pai + filhos num só comando) é recusada em qualquer lugar; chaves primárias não podem ser alteradas dentro de transação;
- uma operação toca no máximo 5.000 linhas dentro de uma transação.

**O que isso não é:** um banco com transações de verdade. Duas consequências práticas: (a) leituras feitas *fora* de uma transação podem ver, por instantes, algo que ainda vai ser desfeito (todas as decisões de dinheiro são tomadas *dentro* da transação, já protegidas); (b) todas as escritas passam por uma fila única, então o site é pensado para **movimento pequeno**; quantas transações por segundo o D1 real aguenta **não foi medido**.
