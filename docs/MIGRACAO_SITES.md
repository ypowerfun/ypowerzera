# Migração para ChatGPT Sites — checkpoint, não publicável

Fonte do produto: `45fb374d7941eee77dc348ca818928a93f87861d`.
Fonte publicada preservada: `6faef0c50e22ff7bc3687b6006318ab241759529`, versão 7.
Site: `appgprj_6ab3dffff1d08191aacbef075f391aed`.
Domínio: https://primearena1.com.br, público e HTTPS ativos.

## Implementado neste checkpoint

- Configuração inicial OpenNext e saída Next standalone; build OpenNext executado.
- Envio Resend por HTTP, timeout de 10 s, até três tentativas com a mesma chave de idempotência, erros sem corpo do provedor ou credenciais.
- Produção sem provedor de e-mail não grava mensagens em disco nem imprime links privados.
- Preparação local de SQLite antes de `prisma db push`; execução de TypeScript por `node --import tsx`, sem depender de socket IPC do executável tsx.
- Primeira operação de inscrição gratuita em `src/server/d1/free-registration.ts`: SQL preparado, escolha atômica da vaga, unicidade de elenco, auditoria e rollback em um batch. Ainda não ligada às rotas.
- Candidato de esquema aditivo dos 35 modelos em `migration/new-models.sql`, usado somente no banco local de teste. Nenhuma migração em produção foi aplicada.

## Verificações

- Typecheck original e após as alterações passou.
- Suíte final após estas alterações: 625/625 testes unitários passaram em 33 arquivos.
- Suíte original: 621/622 passaram na primeira execução; o teste de reset que falhou passou depois da correção da criação do SQLite e do comando tsx.
- Testes específicos do transporte HTTP e configuração: 24 passaram, incluindo três testes novos.
- Scrypt com N=32768, r=8, p=3 e chave de 64 bytes funcionou no workerd local (aproximadamente 202 ms).
- `node tests/runtime-d1.mjs`: vinte inscrições concorrentes para três vagas produziram três confirmadas e dezessete em espera; repetição idempotente não duplicou registros; conflito de jogador entre times reverteu participante, elenco e auditoria; condições alteradas e suspensão foram recusadas; falha injetada na auditoria reverteu a operação inteira.
- OpenNext empacotou o Next 16.3.8. Isso não prova compatibilidade da camada Prisma nativa em runtime.
- O E2E chegou à etapa de iniciar Chromium, mas o binário não existe neste ambiente; o download retornou arquivos inválidos. Não considerar os 29 testes aprovados.

## Banco publicado preservado

Inspeção completa, sem truncamento: `tournaments`, `recovery_challenges` e `recovery_limits` vazios; `viradao_events` com um evento; `viradao_participants` com nove participantes, sem comprovantes vinculados e sem removidos. Uma exportação recuperável das cinco tabelas foi salva separadamente, fora do Git. Ela é uma captura de leitura por tabela, não um snapshot transacional do D1. Antes do corte, fazer backup consistente e revalidar alterações ocorridas desde a captura.

A versão atual tem upload privado de comprovantes em R2 e rotas de viradão. Preservar `BUCKET`, tabelas, autorização, endpoint de comprovante e funcionalidade de viradão. O pacote novo não contém esses recursos.

## Trabalho indispensável antes de publicar

1. Substituir a camada Prisma nativa por repositórios D1. Não usar um adapter que ignore transações.
2. Integrar a inscrição SQL ao fluxo validado, contemplando retirada, retorno, fila de espera, plataforma e mudança concorrente de elenco.
3. Migrar atomicamente autenticação, confirmação/reset de senha, revogação de sessões, administração, organizações, times, fases, partidas e placares. Preservar o descarte da senha e das sessões no fluxo de confirmação do administrador.
4. Conservar o formato de scrypt e AES-GCM/HKDF; dimensionar a fila de hashing para a memória compartilhada de 128 MB. O teste de um hash isolado não valida rajadas.
5. Gerar o esquema novo com Drizzle junto às cinco tabelas e às três migrações antigas imutáveis, sem DROP, reset ou recriação. O arquivo candidato em `migration/` não deve ser aplicado diretamente.
6. Portar o viradão existente, sem perder suas nove inscrições ou as proteções do R2.
7. Preparar exportação consistente/recuperação do D1 e substituir rotinas de limpeza/cron de Docker pelas capacidades disponíveis no Sites.
8. Configurar somente novos valores necessários no Sites: `APP_URL=https://primearena1.com.br`, `WALLET_ENABLED=false`, `PAYMENTS_PROVIDER=none`, `ADMIN_EMAILS`, `MAIL_FROM`, `RESEND_API_KEY`, segredos novos necessários. Preservar `ADMIN_EMAIL` existente; o valor é secreto e não foi lido nem alterado. Nunca guardar chaves no manifesto ou no Git.
9. Validar o Worker completo com D1: cadastro, confirmação, recuperação, administração, inscrição e concorrência. Executar os testes de navegador quando o Chromium estiver disponível.
10. Adaptar a saída OpenNext ao contrato `dist/server/index.js` e `dist/client`, validar o arquivo com o empacotador do Sites, usar `site-workflow.mjs`, salvar versão e publicar no mesmo Site público. Conferir o status da implantação e executar a verificação pós-publicação.

Não houve publicação, alteração de DNS, mudança de público, alteração de variáveis ou escrita no banco publicado neste checkpoint. Esta branch não é uma versão completa pronta para substituir a atual.
