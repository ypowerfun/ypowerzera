# Migração para ChatGPT Sites — em andamento, não publicar este checkpoint

Site existente: `appgprj_6ab3dffff1d08191aacbef075f391aed`.
Domínio: https://primearena1.com.br. Público e HTTPS preservados.
Última publicação confirmada: versão 7, fonte `6faef0c50e22ff7bc3687b6006318ab241759529`.
Produto original: `45fb374d7941eee77dc348ca818928a93f87861d`.

## Estado em 8 de outubro de 2026

O Next 16.3.8 foi empacotado com OpenNext 1.20.9 e carregou no workerd local com D1. O Prisma agora tem dois clientes: SQLite nativo para desenvolvimento/testes existentes e WASM com adapter D1 para a compilação Sites. O cliente Worker é gerado em `node_modules/@primearena/prisma-worker`, declarado externo no Next e empacotado pelo Wrangler; isso evita que o Turbopack instancie o WASM antes do Prisma. O import explícito `wasm.js` evita um export do Prisma 6.19.3 que aponta para `wasm.mjs` ausente.

O adapter normaliza parâmetros DateTime para milissegundos, compatíveis com as condições SQL preparadas. Ele **recusa** transações Prisma não migradas, inclusive operações aninhadas que iniciam transações implícitas. Não remover essa proteção: o adapter padrão D1 ignora garantias transacionais. Esta proteção também significa que os fluxos ainda não portados não estão prontos para produção.

## Operações portadas e conectadas à aplicação

- Perfil ChatGPT: User e ChatGPTIdentity em um batch, unicidade de subject/e-mail/username, rollback e repetição concorrente sem conta órfã. E-mail não concede privilégios nem vincula conta antiga. Administrador somente pelo subject confiável do Site em `CHATGPT_ADMIN_USER_IDS`, além dos papéis existentes no banco.
- Limitação de tentativas: UPSERT condicional atômico, sem ultrapassar o limite por concorrência.
- Criação de time e organização: batch com vínculo de capitão/dono, autorização reavaliada no banco e auditoria da organização.
- Conta de jogo: UPSERT preparado e restrição única `(gameId, handle)`, impedindo que o mesmo identificador seja reivindicado por duas contas simultâneas.
- Inscrição gratuita: capacidade, elenco, plataforma, conta suspensa, papel do capitão, estado do campeonato e auditoria reavaliados dentro do batch.
- Check-in/desfazer e retirada gratuita: condições no banco; retirada, notificação, promoção da fila e auditoria no mesmo batch. O caminho financeiro não é aceito por essas operações gratuitas.
- Criação de campeonato com suas fases/auditoria; publicação e abertura de check-in com versão e autorização verificadas no batch.
- Administração de usuários: troca de cargo e suspensão/reativação em batch, revalidação do administrador por subject/papel, proteção de administradores, compare-and-set, auditoria, notificações e revogação de sessões com rollback. Edição do perfil usa atualização condicional preparada.
- Notificações avulsas e marcação como lidas em SQL preparado. Notificações pertencentes a outra transação continuam sob responsabilidade do respectivo batch.

## Login e Viradão

As rotas reservadas `/signin-with-chatgpt` e `/signout-with-chatgpt` usam links HTML `target="_top"`. Login e recuperação da conta ChatGPT pertencem à plataforma. Senhas locais, confirmação e recuperação antigas só são acessíveis com `AUTH_PROVIDER=local`; não são habilitadas no Sites. Formatos scrypt e AES-GCM/HKDF não foram alterados.

`/viradao`, `/api/viradao` e `/api/viradao/comprovante` reutilizam as tabelas antigas e o binding privado `BUCKET`. Preservam eventos, nome/nick públicos, pagamento privado, comprovantes privados de até 5 MB, concorrência por versão, remoção reversível e restauração. O pacote original não tinha uploads; o Viradão antigo tem comprovantes em R2 e eles precisam continuar disponíveis.

Resend por HTTP está implementado, com timeout, repetição idempotente e erros sem credenciais. Produção sem provedor de e-mail não grava `.dev-mail` nem imprime links privados. A credencial de produção ainda não foi configurada.

## Migração de esquema preparada, não aplicada

`db/schema.ts` contém as cinco tabelas existentes e os 36 modelos novos. `drizzle/0000*`, `0001*`, `0002*` e seus metadados foram copiados da fonte publicada sem alterações. A nova `0003_prime_arena_sites.sql`, gerada pelo Drizzle, acrescenta as tabelas e índices novos, sem DROP, ALTER ou alteração de registros antigos. Datas novas têm armazenamento inteiro em milissegundos.

`migration/new-models.sql` é apenas a referência anterior gerada do Prisma. Não deve ser aplicada à produção. Os testes Worker agora usam as migrações Drizzle reais em `tests/helpers/d1-schema.mjs`.

O teste de migração mantém registros sintéticos nas cinco tabelas antigas, incluindo um campeonato e nove participantes do Viradão, compara todos os registros antes/depois e verifica as chaves estrangeiras.

Na inspeção anterior da produção: tournaments/recovery_challenges/recovery_limits vazios; um evento e nove participantes do Viradão. A cópia recuperável foi salva separadamente, fora do Git. Trata-se de leitura por tabela, não de snapshot transacional; obter cópia consistente e revalidar alterações antes do corte. Nenhuma escrita foi realizada no banco publicado.

## Validações executadas

- 632 testes unitários passaram em 34 arquivos. Após o ajuste da criação de campeonato, 33 testes direcionados de campeonatos, organizações e ChatGPT passaram novamente.
- Typecheck passou. Após a migração administrativa, 23 testes de papéis/autorização e sete de login ChatGPT passaram novamente.
- `node tests/runtime-prisma-d1.mjs`: leitura Prisma WASM/D1, comparação de datas, perfil concorrente, times/organizações, limites simultâneos, unicidade de conta de jogo, criação/publicação concorrente de campeonato e rollback com falha de auditoria. Transações não suportadas falham antes de gravar.
- `node tests/runtime-d1.mjs`: 20 inscrições para três vagas resultaram em três confirmadas e 17 em espera; repetição idempotente; conflito de elenco; suspensão/versão; check-in; retirada e promoção de fila; rollback.
- `node tests/runtime-migration.mjs`: migração aditiva e preservação dos registros antigos em D1.
- OpenNext build e dry-run Wrangler passaram. Pacote Worker observado com aproximadamente 3,4 MiB comprimidos. `scripts/package-opennext.mjs` recusa variáveis privadas incorporadas e limpa somente saídas reproduzíveis para não incluir chunks antigos.
- O teste do aplicativo completo confirmou páginas de login/cadastro/Viradão, API pública e consulta autenticada com D1. O envio real do formulário de cadastro criou o perfil e redirecionou para a conta. O teste da compilação limpa confirmou a página administrativa e a promoção de usuário a organizador pela Server Action; a mesma ação sem permissão foi recusada. O Miniflare exige origem/host locais consistentes e corpo multipart serializado; isso é configuração do teste, sem afrouxar a proteção de origem do aplicativo. O cache persistente de compilação foi desativado após detectar reutilização de código antigo entre sessões restauradas.
- Os 29 testes de navegador não foram aprovados nesta migração: a tentativa anterior não encontrou Chromium utilizável. O teste HTTP/Worker não é um substituto da validação de navegador.

## Pendências obrigatórias antes de substituir a publicação

1. Portar as demais operações de administração de conteúdo, edição/transferência/exclusão de times e organizações, edição/início/cancelamento de campeonatos, fases, partidas, placares, desclassificação e demais escritas implícitas. A proteção transacional continua recusando caminhos não portados.
2. Concluir testes integrados das ações do produto no Worker e navegador, incluindo administração, fases/resultados e registro/retirada sob concorrência. Um teste unitário SQLite não comprova o comportamento D1.
3. Provisionar o administrador com subject confiável **do mesmo Site**; não inferir pela conta/e-mail do conector. Preservar `ADMIN_EMAIL` existente, que não foi lido nem alterado.
4. Preservar segredos existentes e configurar apenas os necessários pelo Sites: APP_URL, AUTH_PROVIDER=chatgpt, CHATGPT_ADMIN_USER_IDS, APP_SECRET e envio HTTP. Não gravar segredos no Git ou manifesto.
5. Fazer backup consistente e plano de recuperação antes de aplicar migrações. Substituir as rotinas de manutenção Docker/disco por capacidades suportadas do Sites.
6. Carteira e pagamentos permanecem desligados: WALLET_ENABLED=false, PAYMENTS_PROVIDER=none. O usuário escolheu preservar créditos sacáveis; ativação financeira depende de provedor que aceite expressamente o modelo. Não ativar Stripe para competições com prêmio financeiro e não substituir garantias financeiras por transações ignoradas.
7. Reconstruir a versão final, validar o arquivo pelo fluxo Sites, enviar a fonte exata, salvar e publicar no mesmo projeto público. Uma publicação malsucedida pode já ter aplicado migrações; não reescrever históricos aplicados.

Não houve publicação, mudança de DNS/público, alteração de variáveis nem escrita no banco de produção neste checkpoint.
