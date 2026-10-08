# Segurança: o que foi verificado, o que foi corrigido e o que ainda é risco

Nenhum site é "à prova de hacker". Este documento diz com honestidade **o que foi testado**, **o que foi corrigido antes do lançamento** e **o que continua sendo risco**, para você decidir com os olhos abertos.

---

## 1. Como foi verificado

1. **Testes automáticos** (mais de 590 de unidade e 29 de navegador) cobrem o motor de campeonatos, contas, carteira, saques, desafios, webhooks e a configuração de produção. Cada correção de segurança abaixo tem pelo menos um teste que **falha se a correção for removida** (conferido tirando a correção de propósito).
2. **Auditoria adversária por superfície de ataque**, em duas rodadas: autenticação/sessões/e-mail, autorização (quem pode o quê), injeção/XSS/redirecionamentos, dinheiro/webhooks/agendador e regras dos campeonatos. Cada achado foi conferido no código antes de ser corrigido.
3. **Ensaio em modo produção** (o site rodando como vai rodar no ar, com um servidor de e-mail de teste): cadastro, e-mail de confirmação com o endereço público, cookie de sessão, criação do administrador, bloqueio de tentativas de login, redirecionamento malicioso, pastas e arquivos que não podem ser servidos, rotas protegidas e cabeçalhos de segurança.
4. **`npm run verificar-site -- https://seusite.com.br`**: o mesmo tipo de checagem, que você roda no site já no ar (veja `HOSPEDAGEM.md`).

> Isto **não substitui** um teste de invasão feito por profissionais. Antes de movimentar dinheiro de verdade, vale contratar um.

---

## 2. O que foi encontrado e corrigido antes do lançamento

**Contas e login**
- Rajada de palpites de senha em paralelo passava pelo limite de tentativas (o contador só subia depois de testar a senha). Agora a tentativa é reservada **antes**, de forma atômica: só 8 palpites por conta+IP em 15 minutos, mesmo com centenas de pedidos simultâneos.
- Ninguém consegue **bloquear a conta de outra pessoa** de fora: o limite principal é por conta **e** IP.
- Rajadas não travam mais o servidor (fila limitada para o cálculo pesado da senha); IPv6 é agrupado por bloco /64; entradas gigantes não viram dados no banco; limites, sessões e links vencidos são limpos sozinhos.
- **E-mail do administrador**: quem se cadastrasse antes do dono com o e-mail dele escolhia a senha e já ficava logado; quando o dono clicasse no link de confirmação, o invasor viraria administrador. Agora, ao confirmar, a senha escolhida no cadastro é **descartada**, as sessões são derrubadas e só quem lê aquela caixa de entrada cria a senha.
- Nome de exibição sem quebras de linha e caracteres invisíveis (falsificavam o texto do e-mail); nomes de usuário como "admin" e "suporte" são reservados; senhas tipo "Senha@2026" (palavra comum + número) são recusadas.
- **Redirecionamento aberto** após o login (`?next=/<TAB>/site-mal-intencionado`) corrigido.

**Conteúdo e entradas**
- Links de transmissão/Discord aceitavam `javascript:` na criação do campeonato (XSS guardado): agora só `http(s)`, na criação e na exibição.
- Páginas com parâmetro repetido na URL (`?q=a&q=b`) ou número de página inválido davam erro 500: corrigido.

**Quem pode o quê**
- Remover uma inscrição **paga** (que reembolsa) exige admin da organização, não equipe de apoio; admin da organização não cria nem remove outro admin; o dono pode remover membros.
- Troca de capitão passa a inscrição do time ao novo capitão (o ex-capitão não segue mandando).
- Premiação anunciada só pode **aumentar** depois de haver inscritos; taxa de inscrição exige provedor de pagamento; rascunho não vaza.
- Cupom e disputa têm limite de tentativas e de tamanho; desclassificado não apaga a punição desistindo; cupom de 100% devolve o uso ao desistir; o contador de cupons nunca fica negativo.
- Quem fica de fora ao iniciar o campeonato é avisado e, se tinha pago e o check-in ainda estava aberto, é reembolsado.
- O admin agora pode **suspender e reativar contas** (Admin → Usuários): a pessoa é desconectada na hora.

**Dinheiro (Fase 2)**
- Chamadas falsas aos webhooks do Pix gravavam uma linha no banco cada (enchia o disco): limitado a poucas por 10 minutos.
- Em produção com Asaas, o CPF do pagador passa a ser exigido por padrão (o Asaas não informa quem pagou), e uma chave de **teste** da Stripe é recusada.
- Pix pago cujo aviso se perdeu é creditado pela reconsulta do agendador; depósito retido só é liberado se o provedor ainda o mostra como pago; estorno enquanto retido é tratado.
- Falha de e-mail no saque nunca prende o saldo; reembolso automático que falha avisa a organização e quem pagou.
- Envio de CPF de outra pessoa só para "reservá-lo" não bloqueia mais o titular verdadeiro (os admins são avisados quando um CPF é enviado por duas contas).
- Quem alega vitória em um desafio faz o adversário receber **e-mail** (antes só havia aviso dentro do site).

**Servidor**
- O site se recusa a subir (e responde erro 500 em tudo) com configuração insegura: segredos fracos, endereço sem https, sem e-mail, sem `MAIL_FROM` real, sem administrador definido, provedor simulado, **ou com o banco de demonstração** (contas com senha pública).
- Logs do Docker com rotação (não enchem o disco); cópias do banco consistentes todo dia.

---

## 3. O que continua sendo risco (leia)

| Risco | Detalhe | O que fazer |
|---|---|---|
| **Um servidor só** | Projeto pensado e testado para 1 instância com SQLite. Duas cópias no mesmo banco não são suportadas. | Não escale horizontalmente sem migrar para Postgres e retestar. |
| **Docker não construído no desenvolvimento** | O ambiente onde o projeto foi feito não tem Docker. Os mesmos passos (instalar, montar, criar o banco, subir em modo produção) foram executados e testados sem Docker. | O primeiro `docker compose up -d --build` no seu servidor é a primeira montagem da imagem. Se falhar, o erro aparece no build. |
| **Asaas nunca validado contra o sandbox real** | O adaptador foi escrito pela documentação pública; a documentação não pôde ser acessada durante o desenvolvimento. | Teste cada fluxo no sandbox (`CONFIGURAR_PIX.md`) antes de qualquer valor real. |
| **Stripe (Pix) nunca validado contra a API real; CPF do pagador é declarado** | Com `PIX_PROVIDER=stripe` o adaptador foi escrito a partir de resumos da documentação. O CPF de quem pagou é digitado pelo pagador na página do Stripe (o Stripe em geral só confere o formato), e o saque é pago **à mão** por um admin. | Teste tudo no modo de teste do Stripe, confira os primeiros depósitos no painel do Stripe, mantenha limites baixos e a liberação do admin em todo saque (`CONFIGURAR_PIX.md`, seção 10). |
| **Dinheiro em desafios pode ser regulado** | Apostas entre jogadores podem se enquadrar em regras de jogos de azar/apostas no Brasil e provedores costumam proibir. | Consulte um advogado antes da Fase 2. A Fase 1 (campeonatos gratuitos) não tem esse risco. |
| **Liquidação automática por silêncio** | Em desafios de até R$ 100, se um lado alega vitória e o outro não responde em 60 min, o resultado vale. O adversário agora recebe e-mail, mas quem fica offline pode perder. | Se quiser desligar: `AUTO_SETTLE_MAX_STAKE_CENTS=0` no `.env` (todo resultado passa a exigir confirmação/arbitragem). |
| **Admin sem 2º fator** | Não há verificação em duas etapas. | Use senha longa e única no e-mail do administrador, e proteja a caixa de entrada dele com 2º fator no provedor. Uma conta de e-mail invadida = senha do admin redefinível. |
| **Sem CAPTCHA** | Cadastros em massa são limitados por IP, mas um atacante com muitos IPs ainda pode criar contas. | Se virar problema, ponha o Cloudflare Turnstile no cadastro e monitore. |
| **ID de jogo "reservado"** | Alguém pode vincular primeiro o ID de jogo de outra pessoa e impedir a inscrição dela até o suporte resolver. | Hoje a correção é manual (suporte); fica como melhoria. |
| **Dependências** | `npm audit` aponta 3 avisos "altos" na cadeia da ferramenta de linha de comando do Prisma (`deepmerge-ts`). Ela só lê arquivos de configuração **do próprio projeto**, nunca dados de usuários, e não roda para visitantes. | Atualize o Prisma quando houver versão corrigida compatível. Rode `npm audit` de vez em quando. |
| **Segredos e backup** | Perder o `.env` ou a `DATA_ENCRYPTION_KEY` perde os CPFs cifrados; backups no mesmo servidor somem junto com ele. | Guarde o `.env` e os backups **fora** do servidor (`HOSPEDAGEM.md`, seção 8). |
| **Cloudflare/CDN na frente** | Com o proxy laranja, o IP real do visitante se perde e os limites por IP passam a valer para todos juntos. | Use "somente DNS" (nuvem cinza) ou ajuste a configuração do proxy (`TRUST_PROXY`). |

---

## 4. Rotina de segurança recomendada (10 minutos por semana)

1. `docker compose ps`: tudo `running`/`healthy`.
2. Em **Admin → Configurações → Verificação do site**: tudo ✓ (agendador rodando, e-mail configurado).
3. `docker compose logs --tail=200 app | grep -i "erro\|\[mail\]"`: falhas de e-mail ou erros repetidos.
4. Baixar uma cópia do banco e do `.env` para fora do servidor.
5. `npm run verificar-site -- https://seusite.com.br` depois de qualquer mudança.
6. Atualizar o servidor (`apt-get update && apt-get upgrade`) e reiniciar quando pedir.
7. Em Admin: filas de KYC, saques em análise e depósitos retidos zeradas; **conciliação** sem divergência.

Em caso de incidente (suspeita de invasão): `PAYOUTS_PAUSED="true"` no `.env` + `docker compose up -d` suspende todos os saques na hora; a chave da carteira em **Admin → Configurações** desliga a carteira inteira; para **deslogar todo mundo** (por exemplo, depois de um vazamento de senhas) rode no servidor:

```bash
docker compose exec app node -e "const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();db.session.deleteMany().then(r=>{console.log('sessões encerradas:',r.count);return db.\$disconnect()})"
```

Troque também a senha de quem foi afetado (**Esqueci minha senha** na tela de entrada). A `DATA_ENCRYPTION_KEY` (que protege os CPFs) **nunca** deve ser trocada com o site no ar.

---

## 5. Se você hospedar no ChatGPT Sites (Cloudflare Workers + D1)

As proteções das seções anteriores valem também no Sites (o código é o mesmo). O que muda, em termos de segurança:

- **Conferência na subida.** No Sites não existe "subida do servidor", então as mesmas travas do Docker (configuração perigosa, contas de demonstração no banco) rodam **uma vez por Worker, antes de qualquer página** (`src/server/boot-guard.ts`). Configuração insegura => o site responde erro em tudo, em vez de ficar no ar. **Atenção:** os endpoints de API (`/api/cron`, webhooks) não passam por essa conferência; eles se protegem pelos próprios segredos (`CRON_SECRET`, assinaturas dos webhooks).
- **IP do visitante.** Os limites de tentativas usam o cabeçalho `cf-connecting-ip`, que a Cloudflare **sobrescreve** em todo pedido (o visitante não consegue forjá-lo). Se o site for acessado por um caminho que não passa pela Cloudflare (ex.: pré-visualização local), o IP vira "desconhecido" e todos dividem o mesmo limite: comportamento seguro, só mais restritivo.
- **Segredos.** Ficam nas *secrets* do Sites, nunca em arquivo do projeto. Nada de `.env` no pacote.
- **Dinheiro e banco.** O D1 não tem transações; o motor próprio (`src/lib/d1-engine.ts`, explicado em `SITES.md`, seção 2) devolve o "tudo ou nada". A **conciliação** em *Admin → Carteiras* continua sendo o seu detector de qualquer divergência; olhe-a toda semana. A tabela `_JournalDead` deve ficar **vazia**: se aparecer algo nela, houve uma transação que não pôde ser desfeita e a conciliação precisa ser conferida.
- **E-mail.** Só por API (Resend/Brevo). A chave é um segredo: se vazar, gere outra no painel do provedor.
- **Limites da hospedagem.** O tempo de CPU por pedido e o número de consultas ao banco são limitados pelo plano; o hash de senha é caro de propósito. Se o login passar a falhar por tempo, **não** reduza o custo do hash sem pedir ajuda: troque de plano ou de hospedagem.

