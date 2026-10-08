# Texto para colar no ChatGPT (Codex) junto com o projeto

> Como usar: abra uma conversa do ChatGPT/Codex **com este projeto anexado** (o `.zip` ou a pasta) e cole **tudo o que está dentro da caixa abaixo**. **Nunca** cole senhas, chaves de API nem o conteúdo do `.env` na conversa: os segredos você digita só nas configurações do site, quando ele pedir.

```text
Este projeto é o "Prime Arena", um gerenciador de campeonatos de esports (Next.js 16, App Router) já preparado para o ChatGPT Sites (Cloudflare Workers + banco D1). Leia primeiro docs/SITES.md, docs/SEGURANCA.md e AGENTS.md (o Next.js deste projeto tem mudanças de API; a documentação está em node_modules/next/dist/docs/).

Objetivo: publicar o site com o ChatGPT Sites e me dizer, em português simples, o que falta eu fazer (domínio, segredos, e-mail).

Faça, nesta ordem:
1. Confira se o projeto é compatível com o Sites (Deploy this project with Sites). Se algo exigir ajuste, EXPLIQUE antes de mudar e mude o mínimo.
2. Instale e monte com: npm install && npm run build:sites  (isso usa o OpenNext para Cloudflare; o arquivo open-next.config.ts já marca o alvo "sites").
3. Crie o banco D1 com o binding de nome exatamente DB e aplique TODAS as migrações da pasta migrations/ em ordem (0001_prime_arena.sql, depois 0002_d1_engine.sql). Não use "prisma db push" nem outro banco: o D1 não aceita; o projeto usa um motor de transações próprio (src/lib/d1-engine.ts) que depende das tabelas _Lease e _Journal da migração 0002.
4. Gere a ligação do projeto com o Sites (o arquivo de hospedagem que o Sites usa para o projeto, com o banco D1 DB) do jeito que a documentação atual do Sites pedir. Mantenha wrangler.jsonc e worker.ts coerentes com isso (worker.ts trata o agendador "scheduled").
5. Configure as variáveis do site conforme a tabela da seção 4 de docs/SITES.md. As marcadas "secret" devem ser cadastradas como segredos nas configurações do Sites, e VOCÊ NÃO DEVE ME PEDIR para colá-las no chat: me diga o nome de cada uma e onde digitá-la.
6. Publique primeiro como "versão salva" (sem ir ao ar), me mostre o endereço de revisão e só depois publique de verdade.
7. Rode e me mostre o resultado de: npm run typecheck, npm test e npm run test:d1 (se o ambiente permitir), e do teste de fumaça: npm run smoke:sites.
8. Me diga se o Sites aceita Cron Trigger (para o agendador, docs/SITES.md seção 5) ou se preciso de um serviço externo chamando POST /api/cron/wallet.
9. Me diga os LIMITES do meu plano do Sites que importam aqui: tempo de CPU por pedido (o hash de senha com scrypt gasta CPU), número de consultas ao banco por pedido, tamanho máximo do site e se há algum bloqueio para o tipo de conteúdo (campeonatos gratuitos na Fase 1; carteira e desafios com dinheiro só depois).

Regras que NÃO podem ser quebradas:
- Não altere src/lib/d1-engine.ts, as migrações já existentes nem a lógica de dinheiro (carteira, saques, desafios) sem me avisar e sem rodar npm run test:d1 depois.
- Não habilite a carteira nem o pagamento de inscrição (WALLET_ENABLED e PAYMENTS_PROVIDER ficam "false"/"none") até eu pedir a Fase 2.
- Não desligue verificações de segurança nem a regra que impede o site de subir com configuração insegura (src/lib/env.ts, src/server/boot-guard.ts).
- Não apague nem sobrescreva o site que já está no ar (primearena1.com.br) nem os dados dele. Este projeto é uma instalação separada.
- Se algo falhar, mostre o erro completo (sem segredos) e proponha a correção; não "contorne" testes.
```
