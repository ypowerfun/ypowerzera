# Lançamento de primearena1.com.br

Estado desta atualização: configuração e scripts preparados; hospedagem, DNS, SMTP e entrega real de mensagens ainda precisam ser configurados e verificados. O remetente no arquivo de exemplo não cria uma caixa postal nem verifica o domínio.

## Hospedagem escolhida: Sites do GPT

O site existente foi localizado em https://primearena1.com.br, no projeto Sites já existente, versão 7. Seu banco atual é Cloudflare D1 (binding DB), com as tabelas recovery_challenges, recovery_limits, tournaments, viradao_events e viradao_participants.

Este repositório usa Next.js e Prisma com SQLite em arquivo. O banco publicado tem um esquema diferente; copiar o repositório ou configurar SMTP não migra o aplicativo nem seus dados. É necessário adaptar e testar o backend para o runtime e banco do Sites antes de atualizar a publicação existente. Não foi criado outro site.

Os scripts desta atualização operam no banco Prisma deste repositório; **não operam no D1 do site publicado**. Nenhuma conta ou inscrição do site existente foi excluída. A migração para Sites ainda está pendente devido à falha do ambiente local, que impede acessar o código da publicação e executar builds.

## Referência do projeto atual: Docker com banco persistente

Siga docs/HOSPEDAGEM.md para o servidor Ubuntu/Debian. O projeto já usa SQLite em volume persistente, com backups, Docker e Caddy para HTTPS. Uma instalação nova cria as tabelas sem executar a seed e começa sem contas.

No instalador, use:
- Domínio: primearena1.com.br
- E-mail do administrador: uma caixa de entrada sua que você consegue acessar
- SMTP: fornecido pelo seu serviço de envio
- Remetente: Prime Arena <noreply@primearena1.com.br>

O instalador pergunta esses valores; o padrão do remetente dele precisa ser substituído pelo endereço acima. Um .env existente é preservado: neste caso, ajuste DOMAIN, APP_URL e MAIL_FROM nesse arquivo sem trocar os segredos. O modelo .env.production.example só afeta novas configurações.

Para apenas enviar confirmações, valide o domínio/remetente no provedor SMTP e publique os registros DNS indicados por ele (SPF/DKIM e a política DMARC apropriada ao domínio). Para receber respostas nesse endereço também, é necessária uma caixa postal em um serviço de e-mail. Não substitua registros MX existentes sem conferir o serviço atual.

## Confirmar que não existem contas

Depois de subir o container, antes de divulgar o endereço ou cadastrar o admin:

```bash
docker compose exec -T app npm run contas:verificar
```

O comando lê o banco usado pelo container e retorna sucesso somente se houver zero usuários. Não exclui contas nem outros dados. Não rode npm run setup, npm run db:seed ou npm run reset para preparar produção: esses comandos servem ao ambiente de demonstração.

Não foi inspecionado nenhum banco de produção nesta atualização. Se já houver contas reais ou de exemplo, identifique o banco e faça backup antes de limpar. Não use docker compose down -v: isso também remove o volume com os backups. Um repositório sem arquivo de banco não prova que o servidor está vazio.

## Cadastrar seu administrador

Configure ADMIN_EMAILS no .env com seu e-mail real e aplique a configuração:

```bash
docker compose up -d
docker compose exec -T app npm run admin:criar -- SEU_EMAIL SEU_USUARIO "Seu nome"
```

Substitua os três valores; usuário deve ter 3 a 20 caracteres (letras, números ou sublinhado). O comando cria uma conta pendente, sem senha conhecida e sem cargo privilegiado. Ele envia a confirmação pelo mesmo fluxo dos cadastros do site. Clique no link na sua caixa de entrada e escolha a senha. Só depois da confirmação o e-mail configurado em ADMIN_EMAILS ganha acesso administrativo.

Se o leitor de e-mail já consumiu o link e a tela não permitir escolher a senha, use "Esqueci minha senha" no site.

Se o SMTP falhar, a conta poderá já existir, ainda pendente. Depois de corrigir a configuração, repita com os mesmos e-mail e usuário:

```bash
docker compose exec -T app npm run admin:criar -- SEU_EMAIL SEU_USUARIO "Seu nome" --reenviar
```

O comando não sobrescreve contas existentes nem reativa contas suspensas. Não crie contas de exemplo em produção. O endereço noreply é o remetente; o administrador deve usar uma caixa que você lê.

## Verificação antes de abrir cadastros

- Confira HTTPS, saúde dos containers e os backups conforme docs/HOSPEDAGEM.md.
- Confirme que o e-mail de administrador chegou de noreply@primearena1.com.br e conclua o fluxo de confirmação e definição de senha.
- Teste um cadastro com uma caixa sua, o link de confirmação e a recuperação de senha antes do lançamento.
- Verifique os registros de entrega no serviço SMTP. Aceitação pelo SMTP não garante chegada à caixa de entrada.
- Preserve os segredos no servidor. Não envie .env ou senhas ao GitHub.

## Validação desta alteração

Os novos scripts ainda precisam de execução de testes, typecheck e validação em Docker antes de uso em produção. O terminal da sessão de preparação falhou antes de iniciar processos. Nenhum servidor foi publicado, nenhuma caixa postal foi criada e nenhum banco existente foi apagado.
