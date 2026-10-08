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
- Candidato de esquema dos 35 modelos originais (agora 36 com a identidade ChatGPT) em `migration/new-models.sql`, usado somente no banco local de teste. Nenhuma migração em produção foi aplicada.

## Verificações

- Typecheck original e após as alterações passou.
- Suíte final após estas alterações: 625/625 testes unitários passaram em 33 arquivos.
- Suíte original: 621/622 passaram na primeira execução; o teste de reset que falhou passou depois da correção da criação do SQLite e do comando tsx.
- Testes específicos do transporte HTTP e configuração: 24 passaram, incluindo três testes novos.
- Scrypt com N=32768, r=8, p=3 e chave de 64 bytes funcionou no workerd local (aproximadamente 202 ms).
- `node tests/runtime-d1.mjs`: vinte inscrições concorrentes para três vagas produziram três confirmadas e dezessete em espera; repetição idempotente não duplicou registros; conflito de jogador entre times reverteu participante, elenco e auditoria; condições alteradas e suspensão foram recusadas; falha injetada na auditoria reverteu a operação inteira.
- OpenNext empacotou o Next 16.3.8. O dry-run do Wrangler passou após normalizar declarações de ambiente duplicadas emitidas pelo OpenNext. `scripts/package-opennext.mjs` prepara `dist/server/index.js` e `dist/client`, e o empacotador do Sites aceitou o arquivo local.
- O smoke test do aplicativo completo em workerd falhou: `/entrar` respondeu 500 porque o Prisma procura um motor nativo indisponível no Worker. Não resolver adicionando um binaryTarget: o banco em disco e o motor nativo precisam ser substituídos pelo caminho D1.
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
6. O Viradão já foi portado nesta atualização; validar sua integração na aplicação completa e a leitura do banco publicado antes do corte.
7. Preparar exportação consistente/recuperação do D1 e substituir rotinas de limpeza/cron de Docker pelas capacidades disponíveis no Sites.
8. Configurar somente novos valores necessários no Sites: `APP_URL=https://primearena1.com.br`, `WALLET_ENABLED=false`, `PAYMENTS_PROVIDER=none`, `AUTH_PROVIDER=chatgpt`, `CHATGPT_ADMIN_USER_IDS`, `MAIL_FROM`, `RESEND_API_KEY`, segredos novos necessários. Preservar `ADMIN_EMAIL` existente; o valor é secreto e não foi lido nem alterado. Nunca guardar chaves no manifesto ou no Git.
9. Validar o Worker completo com D1: cadastro, confirmação, recuperação, administração, inscrição e concorrência. Executar os testes de navegador quando o Chromium estiver disponível.
10. Depois de integrar e validar todos os repositórios D1, reconstruir, executar `scripts/package-opennext.mjs` e o smoke test, usar `site-workflow.mjs`, salvar versão e publicar no mesmo Site público. Conferir o status da implantação e executar a verificação pós-publicação.

Não houve publicação, alteração de DNS, mudança de público, alteração de variáveis ou escrita no banco publicado neste checkpoint. Esta branch não é uma versão completa pronta para substituir a atual.

## Atualização: somente Viradão e login com ChatGPT

O escopo funcional desta atualização foi limitado pelo usuário ao Viradão antigo e à autenticação do novo site. As alterações experimentais de depósitos e saques manuais foram retiradas. Não há integração nova com Stripe nem alteração dos módulos financeiros nesta atualização.

- `/viradao`, `/api/viradao` e `/api/viradao/comprovante` reutilizam as tabelas `viradao_events` e `viradao_participants` e o binding privado `BUCKET`. Nenhuma importação, cópia, reset ou exclusão de dados de produção foi executada. O SQL antigo em `migration/legacy/` é uma referência imutável para testes locais, não uma migração a reaplicar no banco publicado.
- A interface usa o cabeçalho e o tema do produto novo, com navegação para Viradão. Mantém eventos separados, nome/nick públicos, situação de pagamento privada, comprovantes privados de até 5 MB, concorrência por versão, remoção reversível, restauração e compartilhamento da lista pública.
- O login usa as rotas reservadas do Sites, com links HTML para `/signin-with-chatgpt` e `/signout-with-chatgpt`. O novo modelo `ChatGPTIdentity` associa o subject estável ao perfil; a criação de perfil é idempotente e não exige uma senha local.
- E-mail informado pela plataforma não vincula uma conta antiga nem concede administração. `CHATGPT_ADMIN_USER_IDS` permite provisionar o administrador por subject confirmado. Este valor ainda precisa ser definido na preparação da publicação, usando identidade confiável do mesmo Site. `ADMIN_EMAIL` existente continua preservado.
- Senha, recuperação e confirmação local ficam disponíveis somente com `AUTH_PROVIDER=local`; com ChatGPT, o fluxo de login e sua recuperação pertencem à plataforma. Ações sem identidade/perfil recusam a operação, sem iniciar login por fetch ou redirecionamento de Server Action.
- O candidato `migration/new-models.sql` agora contém 36 modelos, incluindo a associação de identidade. Continua restrito aos testes locais; a produção exige migração aditiva adequada ao Sites.

Validações desta atualização: typecheck aprovado; 28 testes direcionados de autenticação, administração e permissões aprovados, incluindo sete testes novos de identidade/onboarding; quatro testes do serviço Viradão aprovados; teste isolado no workerd com D1/R2 aprovado, incluindo nove registros sintéticos preservados, 12 edições simultâneas com um único vencedor, projeção pública, comprovante privado e remover/restaurar sem apagar. O build Next passou após descartar um cache local corrompido do Turbopack.

Uma execução ampla dos testes encerrou antes do relatório final e não é contada como aprovação. Os 625 testes aprovados acima são do checkpoint anterior, não uma comprovação da migração completa atual. O teste do serviço em Worker não comprova o funcionamento da aplicação Next completa: o bloqueio do Prisma nativo descrito acima permanece. Não houve publicação desta atualização; o Site continua na versão 7.
