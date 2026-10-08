# Prime Arena: comece por aqui

Este pacote é o site completo do Prime Arena. **Você não precisa programar**: precisa escolher um caminho, seguir os guias na ordem e copiar/colar alguns textos e comandos. O arquivo `VERSAO.txt` diz de que data e versão é este pacote: se você tiver dois pacotes, use sempre o mais novo.

## Primeiro, escolha o seu caminho

**A) ChatGPT Sites (sem alugar servidor).** Importante: isto **nunca foi publicado no Sites de verdade** (veja `docs/SITES.md`, seção 9); o ChatGPT vai conferir a compatibilidade antes. Leia nesta ordem:

1. [`docs/SITES.md`](docs/SITES.md): seções 1, 3 e 4 (o passo a passo). Já nesta leitura, decida o **endereço** do site novo e gere os **segredos** (passos 1 e 2 da seção 4): você vai precisar deles ao preencher o texto do ChatGPT.
2. [`docs/CONFIGURAR_EMAIL.md`](docs/CONFIGURAR_EMAIL.md): **só** as seções 2 (use o **Resend**), 3 (verificar o domínio) e **4B**. As outras são do servidor.
3. Cole o texto de [`PROMPT_PARA_O_CHATGPT.md`](PROMPT_PARA_O_CHATGPT.md) numa conversa com **só o `.zip`** anexado (nunca a pasta de trabalho), depois de preencher o bloco "MEUS DADOS".
4. Volte a `docs/SITES.md`, seção 4, passos 4 a 10.

Tempo: **meio dia ou mais**, porque verificar o domínio do e-mail e apontar o DNS pode levar horas. Dinheiro (Pix/Stripe): **só depois**, em [`docs/CONFIGURAR_PIX.md`](docs/CONFIGURAR_PIX.md), **seção 10**.

**B) Servidor próprio (Docker).** Siga a tabela abaixo. Se escolheu o caminho A, **pule** só "O caminho mais curto" e os comandos `docker` de "Os 3 comandos" (são do servidor); o `npm run verificar-site` e a seção "Se algo der errado" valem para os dois caminhos.

## O que fazer, em ordem (caminho B: servidor próprio)

| # | Guia | Para quê | Tempo |
|---|---|---|---|
| 1 | [`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md) | Alugar o servidor, apontar o domínio e colocar o site no ar com HTTPS | 1 a 2 h |
| 2 | [`docs/CONFIGURAR_EMAIL.md`](docs/CONFIGURAR_EMAIL.md) | Fazer o **e-mail de confirmação de conta** (e de "esqueci a senha") chegar aos usuários | 20 a 40 min |
| 3 | [`docs/SEGURANCA.md`](docs/SEGURANCA.md) | O que foi verificado, o que ainda é risco e a rotina semanal de 10 minutos | 10 min de leitura |
| 4 | [`docs/CONFIGURAR_PIX.md`](docs/CONFIGURAR_PIX.md) | **Depois**, com o site estável: ligar depósitos, saques e desafios com dinheiro (Pix) | dias (aprovação do provedor) |

## O caminho mais curto (servidor próprio)

Com um servidor **Ubuntu/Debian novo**, o domínio já apontando para ele e o endereço SMTP em mãos:

No seu computador (troque `NOME-DO-PACOTE.zip` pelo nome exato do arquivo que você recebeu, o mais novo): `scp NOME-DO-PACOTE.zip root@IP_DO_SERVIDOR:/root/`. Depois, no servidor (`ssh root@IP_DO_SERVIDOR`):

```bash
apt-get update && apt-get install -y unzip
mkdir -p /opt/primearena && unzip /root/NOME-DO-PACOTE.zip -d /opt/primearena && cd /opt/primearena
bash scripts/instalar-servidor.sh
```

(Se entrou com outro usuário que não seja `root`, coloque `sudo` na frente de cada comando.)

Ele faz 4 perguntas e cuida do resto (Docker, firewall, segredos, HTTPS). Detalhes e o que fazer antes: seção "Caminho rápido" de [`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md).

> No **servidor próprio**, nenhuma IA (ChatGPT, Codex, Claude…) consegue colocar o site no ar sozinha, porque isso exige o seu servidor e o DNS do seu domínio. No **ChatGPT Sites** a ideia é o próprio ChatGPT publicar na sua conta, mas isso **ainda não foi testado de verdade**; o domínio, o e-mail e os segredos continuam sendo seus. E **nunca** envie a ninguém o arquivo `.env`, as chaves de API nem as senhas do servidor.

## Como lançar sem correr risco

1. **Fase 1: só campeonatos gratuitos.** O arquivo de configuração já vem assim (`WALLET_ENABLED="false"`, `PAYMENTS_PROVIDER="none"`). Não há dinheiro envolvido.
2. **Fase 2: Pix e desafios com créditos.** Só depois de a Fase 1 estar estável, do provedor de Pix aprovado (Asaas no servidor próprio; **Stripe** no ChatGPT Sites) e **testado no ambiente de testes, num site SEPARADO** (nunca com usuários de verdade), de um **backup do banco que você consiga restaurar** e de uma **consulta jurídica** (apostas entre jogadores com dinheiro podem ser reguladas). Detalhes em `docs/CONFIGURAR_PIX.md`.

## Os 3 comandos que você mais vai usar (servidor próprio, na pasta do site)

```bash
docker compose up -d --build     # colocar no ar / aplicar uma atualização ou mudança no .env
docker compose logs --tail=200 app   # ver o que o site está dizendo (erros, avisos)
docker compose ps                # ver se tudo está de pé
```

E, no seu computador (com Node 22 instalado), para conferir o site já no ar (serve para os dois caminhos):

```bash
npm install
npm run verificar-site -- https://seusite.com.br
```

## O que NÃO vai neste pacote (de propósito)

Senhas, chaves e dados: o arquivo `.env` (suas senhas) e o banco de dados **não vêm no zip e nunca devem ser enviados para ninguém**. No servidor próprio, o modelo é `.env.production.example`; você o copia para `.env` no servidor e preenche (`npm run secrets` gera as chaves). No ChatGPT Sites **não existe `.env`**: os segredos vão nas configurações do site (`npm run secrets -- --sites`).

Não existe conta de administrador pré-criada nem senha padrão: o administrador é o e-mail que você colocar em `ADMIN_EMAILS`, e a senha é criada por você depois de confirmar o e-mail.

## Se algo der errado

- **Servidor próprio:** site mostra "Internal Server Error" em tudo: é a trava de segurança. `docker compose logs app` diz o que falta no `.env`.
- **ChatGPT Sites:** todas as páginas mostram "Serviço indisponível": é a mesma trava de segurança. Veja `docs/SITES.md`, seção 11.
- E-mail não chega: `docs/CONFIGURAR_EMAIL.md`, seção 7.
- Antes de qualquer mudança grande, faça uma cópia do banco (servidor: `docs/HOSPEDAGEM.md`, seção 8; Sites: `docs/SITES.md`, seção 9).
