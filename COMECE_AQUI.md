# Prime Arena: comece por aqui

Este pacote é o site completo, pronto para colocar no ar. **Você não precisa programar**: precisa seguir os guias na ordem abaixo e copiar/colar alguns comandos.

## O que fazer, em ordem

| # | Guia | Para quê | Tempo |
|---|---|---|---|
| 1 | [`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md) | Alugar o servidor, apontar o domínio e colocar o site no ar com HTTPS | 1 a 2 h |
| 2 | [`docs/CONFIGURAR_EMAIL.md`](docs/CONFIGURAR_EMAIL.md) | Fazer o **e-mail de confirmação de conta** (e de "esqueci a senha") chegar aos usuários | 20 a 40 min |
| 3 | [`docs/SEGURANCA.md`](docs/SEGURANCA.md) | O que foi verificado, o que ainda é risco e a rotina semanal de 10 minutos | 10 min de leitura |
| 1B | [`docs/SITES.md`](docs/SITES.md) | **Alternativa ao servidor:** hospedar no **ChatGPT Sites** (Cloudflare + banco D1). Vem com um texto pronto para colar no ChatGPT: [`PROMPT_PARA_O_CHATGPT.md`](PROMPT_PARA_O_CHATGPT.md) | 1 a 2 h |
| 4 | [`docs/CONFIGURAR_PIX.md`](docs/CONFIGURAR_PIX.md) | **Depois**, com o site estável: ligar depósitos, saques e desafios com dinheiro (Pix) | dias (aprovação do provedor) |

## O caminho mais curto

Com um servidor **Ubuntu/Debian novo**, o domínio já apontando para ele e o endereço SMTP em mãos:

No seu computador: `scp prime-arena-1.0.zip root@IP_DO_SERVIDOR:/root/`. Depois, no servidor (`ssh root@IP_DO_SERVIDOR`):

```bash
apt-get update && apt-get install -y unzip
unzip /root/prime-arena-1.0.zip -d /opt/primearena && cd /opt/primearena
bash scripts/instalar-servidor.sh
```

(Se entrou com outro usuário que não seja `root`, coloque `sudo` na frente de cada comando.)

Ele faz 4 perguntas e cuida do resto (Docker, firewall, segredos, HTTPS). Detalhes e o que fazer antes: seção "Caminho rápido" de [`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md).

> No **servidor próprio**, nenhuma IA (ChatGPT, Codex, Claude…) consegue colocar o site no ar sozinha, porque isso exige o seu servidor e o DNS do seu domínio. No **ChatGPT Sites** o próprio ChatGPT publica na sua conta (veja `docs/SITES.md`), mas o domínio, o e-mail e os segredos continuam sendo seus. E **nunca** envie a ninguém o arquivo `.env`, as chaves de API nem as senhas do servidor.

## Como lançar sem correr risco

1. **Fase 1: só campeonatos gratuitos.** O arquivo de configuração já vem assim (`WALLET_ENABLED="false"`, `PAYMENTS_PROVIDER="none"`). Não há dinheiro envolvido.
2. **Fase 2: Pix e desafios com créditos.** Só depois de a Fase 1 estar estável, do Asaas aprovado e **testado no ambiente de testes (sandbox)**, e de uma **consulta jurídica** (apostas entre jogadores com dinheiro podem ser reguladas). Detalhes em `docs/CONFIGURAR_PIX.md`.

## Os 3 comandos que você mais vai usar (no servidor, na pasta do site)

```bash
docker compose up -d --build     # colocar no ar / aplicar uma atualização ou mudança no .env
docker compose logs --tail=200 app   # ver o que o site está dizendo (erros, avisos)
docker compose ps                # ver se tudo está de pé
```

E, no seu computador (com Node 22 instalado), para conferir o site já no ar:

```bash
npm install
npm run verificar-site -- https://seusite.com.br
```

## O que NÃO vai neste pacote (de propósito)

Senhas, chaves e dados: o arquivo `.env` (suas senhas) e o banco de dados **não vêm no zip e nunca devem ser enviados para ninguém**. O modelo é `.env.production.example`; você o copia para `.env` no servidor e preenche (`npm run secrets` gera as chaves).

Não existe conta de administrador pré-criada nem senha padrão: o administrador é o e-mail que você colocar em `ADMIN_EMAILS`, e a senha é criada por você depois de confirmar o e-mail.

## Se algo der errado

- Site mostra "Internal Server Error" em tudo: é a trava de segurança. `docker compose logs app` diz o que falta no `.env`.
- E-mail não chega: `docs/CONFIGURAR_EMAIL.md`, seção 7.
- Antes de qualquer mudança grande, baixe uma cópia do banco (`docs/HOSPEDAGEM.md`, seção 8).
