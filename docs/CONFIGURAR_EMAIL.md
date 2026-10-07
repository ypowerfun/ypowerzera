# Como enviar o e-mail de confirmação de conta (e a recuperação de senha)

Quando alguém cria uma conta no site, o site manda um e-mail com um link: **"Confirme seu e-mail para poder se inscrever em campeonatos"**. O mesmo caminho envia o e-mail de "esqueci minha senha". Para isso o site precisa de uma conta de **envio de e-mail (SMTP)**. Este guia leva você do zero até o primeiro e-mail chegando.

> **Resumo em 5 passos:** (1) escolha um provedor de envio, (2) verifique o seu domínio, (3) pegue o endereço SMTP, (4) cole em `SMTP_URL` e `MAIL_FROM` no `.env`, (5) teste com `npm run mail:test -- seu@email.com` ou pelo botão em **Admin → Configurações**.

---

## 1. O que o site faz e o que ele NÃO faz

| Situação | O que acontece |
|---|---|
| Usuário cria a conta | O site grava a conta e envia o e-mail de confirmação. O link vale **48 horas**. |
| O envio falha (SMTP fora do ar, senha errada) | A conta **é criada mesmo assim**, o usuário entra normalmente e o erro vai para os logs (`docker compose logs app`), **sem a sua senha**. O usuário pode pedir outro e-mail em **Minha conta → Reenviar e-mail de confirmação** (limite de 3 por hora). |
| Usuário clica no link | O e-mail fica confirmado. Clicar de novo no mesmo link não dá erro. |
| E-mail não confirmado | O usuário usa o site, mas **não consegue se inscrever em campeonatos**. Também não vira administrador por `ADMIN_EMAILS` até confirmar. |
| E-mail de **administrador** (`ADMIN_EMAILS`) | Ao clicar no link de confirmação, o site pede para **criar a senha** (a do cadastro é descartada). É proposital: só quem lê aquela caixa de entrada vira administrador. |
| "Esqueci minha senha" | Envia um link que vale **1 hora**. A resposta na tela é a mesma exista a conta ou não (ninguém descobre quais e-mails estão cadastrados). |
| Produção sem `SMTP_URL` | O site **se recusa a subir** e diz o motivo (para você não lançar um site que não manda e-mail). |

O site **não** manda propaganda: só estes dois e-mails (mais o de teste, que só o administrador dispara).

---

## 2. Escolha um provedor de envio

Não use o servidor de e-mail do seu computador nem o do VPS: e-mails enviados assim caem no spam ou são recusados. Use um serviço de envio. Todos abaixo têm plano grátis que cobre um site pequeno (confira os limites atuais no site de cada um, eles mudam):

| Provedor | Quando escolher | Observação |
|---|---|---|
| **Brevo** (brevo.com) | O mais simples para começar; plano grátis diário | Dá usuário e uma "chave SMTP" |
| **Resend** (resend.com) | Interface moderna, configuração rápida | Exige verificar um domínio |
| **Amazon SES** | Quando o volume crescer; muito barato | Começa em "sandbox": precisa pedir a saída dele; configuração mais técnica |
| **Zoho Mail / e-mail do domínio** | Se você já tem e-mail profissional no domínio | Limites baixos de envio por dia |
| **Gmail com senha de app** | Só para **testes**; limites baixos e o Google pode bloquear | Exige verificação em duas etapas e uma "senha de app" |

Para o lançamento, **recomendo Brevo ou Resend** com o **seu domínio** verificado.

---

## 3. Verifique o seu domínio (é o que evita cair no spam)

Provedores só entregam bem se provarem que o seu domínio autorizou o envio. No painel do provedor há uma tela "Domínios" / "Remetentes": adicione o seu domínio (ex.: `meusite.com.br`) e ele mostra **registros DNS** (SPF, DKIM e às vezes DMARC) para você criar no lugar onde o domínio foi comprado (Registro.br, GoDaddy, Cloudflare…).

1. Abra o painel do seu domínio → **DNS** → adicione cada registro **exatamente como o provedor mostrar** (tipo `TXT` ou `CNAME`, nome e valor).
2. Volte ao provedor e clique em **Verificar**. Pode demorar de minutos até algumas horas.
3. Só use o `MAIL_FROM` com um endereço **desse domínio** (ex.: `nao-responda@meusite.com.br`) depois que ele estiver "verificado".

Sem isso o provedor pode recusar o envio (erro de remetente) ou o e-mail vai parar no spam.

---

## 4. Pegue o endereço SMTP e monte o `SMTP_URL`

No painel do provedor procure **SMTP** (ou "Credenciais SMTP"). Você vai ver 4 informações: **servidor**, **porta**, **usuário** e **senha** (ou chave). Monte assim:

```ini
# Porta 587 (a mais comum; começa sem criptografia e sobe para TLS):
SMTP_URL="smtp://USUARIO:SENHA@SERVIDOR:587"

# Porta 465 (já começa criptografada):
SMTP_URL="smtps://USUARIO:SENHA@SERVIDOR:465"
```

Exemplos de **forma** (os servidores e usuários reais estão no seu painel; os de baixo mudam com o tempo, confirme na documentação do provedor):

```ini
SMTP_URL="smtp://seu-login@email.com:SUA_CHAVE_SMTP@smtp-relay.brevo.com:587"   # Brevo
SMTP_URL="smtps://resend:SUA_CHAVE_API@smtp.resend.com:465"                    # Resend
```

### Caracteres especiais na senha
Se o usuário ou a senha tiverem `@ : / # ? % $ ! & +` ou espaço, troque cada um pelo código `%XX`:

| Caractere | Código | | Caractere | Código |
|---|---|---|---|---|
| `@` | `%40` | | `#` | `%23` |
| `:` | `%3A` | | `?` | `%3F` |
| `/` | `%2F` | | `%` | `%25` |
| espaço | `%20` | | `+` | `%2B` |

Exemplo: a senha `abc@123/x` vira `abc%40123%2Fx`. Dica: se o login for um e-mail (`voce@exemplo.com`), o `@` dele também vira `%40`.

### Remetente
```ini
MAIL_FROM="Prime Arena <nao-responda@meusite.com.br>"
```
O que está entre `< >` precisa ser do domínio verificado no passo 3.

### Gmail (apenas para testar)
1. Ative a **verificação em duas etapas** na conta Google.
2. Em Segurança → **Senhas de app**, crie uma senha de app (16 letras, sem os espaços).
3. `SMTP_URL="smtps://seuemail%40gmail.com:SENHA_DE_APP@smtp.gmail.com:465"` e `MAIL_FROM="Prime Arena <seuemail@gmail.com>"`.

O site exige **TLS** em produção (a senha do SMTP nunca viaja em texto puro). Por isso use a 587 ou a 465 de um provedor que aceite TLS, que é o caso de todos os acima.

---

## 5. Cole no `.env` e reinicie

No servidor, no arquivo `.env` (veja [`HOSPEDAGEM.md`](HOSPEDAGEM.md)):

```ini
APP_URL="https://meusite.com.br"      # os links do e-mail usam isto: precisa ser o endereço real, com https
SMTP_URL="smtp://...."
MAIL_FROM="Prime Arena <nao-responda@meusite.com.br>"
```

Depois, para aplicar:

```bash
docker compose up -d
```

> ⚠️ **`APP_URL` errado = link quebrado.** Se estiver `http://localhost:3000`, o site se recusa a subir em produção; se estiver com um domínio errado, o link do e-mail leva para o lugar errado.

---

## 6. Teste (faça antes de abrir para o público)

### Opção A: pelo painel (mais fácil)
Entre como administrador → **Admin → Configurações → "Enviar e-mail de teste para mim"**. O e-mail vai para o endereço da sua conta. Se falhar, a tela mostra o motivo provável (sem a senha). Limite: 5 testes por hora.

### Opção B: pelo terminal (antes mesmo de subir o site)
```bash
npm run mail:test -- seu@email.com
```
No servidor com Docker (a imagem já traz tudo; o `--entrypoint` é necessário para rodar o teste em vez de subir o site de novo):
```bash
docker compose run --rm --no-deps --entrypoint ./node_modules/.bin/tsx app scripts/mail-test.ts seu@email.com
```
Se preferir, use a opção A (o botão no painel), que não depende de comando nenhum.

### Opção C: o teste de verdade
Abra o site, crie uma conta com um e-mail seu em **/cadastro** e veja o e-mail chegar. Clique no link; em **Minha conta** o aviso "e-mail não confirmado" some. Faça também **"Esqueci minha senha"** uma vez.

Em **Admin → Configurações → Verificação do site** o item de e-mail fica ✓ quando o `SMTP_URL` está preenchido (ele **não** prova que o provedor aceitou: quem prova é o teste acima).

---

## 7. Quando o e-mail não chega

O botão de teste e o comando `mail:test` traduzem os erros mais comuns:

| Mensagem | O que fazer |
|---|---|
| "Usuário ou senha do SMTP recusados" | Confira usuário e senha; caracteres especiais precisam do `%XX`; no Gmail use senha de app. |
| "Não consegui conectar ao servidor de e-mail" | Servidor ou porta digitados errado. |
| "O servidor de e-mail não respondeu a tempo" | Algumas hospedagens bloqueiam a porta 25/465/587. Tente a outra (587 ↔ 465) ou pergunte ao suporte do VPS se a saída SMTP está liberada. |
| "Falha de TLS" | Combine `smtps://` com a porta **465**, ou `smtp://` com a **587**. |
| "O remetente (MAIL_FROM) foi recusado" | O domínio/endereço do `MAIL_FROM` ainda não foi verificado no provedor (passo 3). |

Se o teste passa mas os usuários não recebem:
1. **Spam / Promoções.** Peça para olharem lá. Domínio verificado (SPF + DKIM) resolve a maior parte.
2. **Hotmail/Outlook.** Alguns provedores "abrem" os links dos e-mails por segurança. O link de confirmação do site é seguro para isso (confirmar duas vezes não dá erro), mas **o link de recuperação de senha só vale uma vez**; se o Outlook o consumir antes, o usuário só precisa pedir outro.
3. **Veja os logs:** `docker compose logs app | grep "\[mail\]"` mostra as falhas de envio (sem senhas).
4. **Painel do provedor:** quase todos têm a lista de e-mails enviados, entregues e recusados, com o motivo.
5. **Limite diário do plano grátis** estourado: o provedor para de enviar até o dia seguinte.

---

## 8. Para quem só quer testar no computador (sem provedor)

Sem `SMTP_URL`, **em desenvolvimento** (`npm run dev`) o site não envia nada: grava o e-mail em um arquivo na pasta `.dev-mail/` e mostra o texto no terminal, inclusive o link de confirmação. Basta copiar o link e abrir no navegador. Isso **só funciona em desenvolvimento**; em produção o `SMTP_URL` é obrigatório.
