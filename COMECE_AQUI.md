# Prime Arena: comece por aqui

Este pacote é o site completo, pronto para colocar no ar. **Você não precisa programar**: precisa seguir os guias na ordem abaixo e copiar/colar alguns comandos.

## O que fazer, em ordem

| # | Guia | Para quê | Tempo |
|---|---|---|---|
| 1 | [`docs/HOSPEDAGEM.md`](docs/HOSPEDAGEM.md) | Alugar o servidor, apontar o domínio e colocar o site no ar com HTTPS | 1 a 2 h |
| 2 | [`docs/CONFIGURAR_EMAIL.md`](docs/CONFIGURAR_EMAIL.md) | Fazer o **e-mail de confirmação de conta** (e de "esqueci a senha") chegar aos usuários | 20 a 40 min |
| 3 | [`docs/SEGURANCA.md`](docs/SEGURANCA.md) | O que foi verificado, o que ainda é risco e a rotina semanal de 10 minutos | 10 min de leitura |
| 4 | [`docs/CONFIGURAR_PIX.md`](docs/CONFIGURAR_PIX.md) | **Depois**, com o site estável: ligar depósitos, saques e desafios com dinheiro (Pix) | dias (aprovação do provedor) |

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
