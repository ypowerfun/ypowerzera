// Gera os segredos que o site precisa em produção. Não precisa de openssl: funciona igual no Windows, macOS e Linux.
//   npm run secrets             → servidor próprio (copie as linhas para o .env do servidor)
//   npm run secrets -- --sites  → ChatGPT Sites (só os 3 segredos que o Sites usa; NÃO crie arquivo .env)
// Guarde uma cópia em lugar seguro: SEM a DATA_ENCRYPTION_KEY os CPFs já cifrados não podem ser recuperados. Cada execução gera
// valores novos: NÃO rode de novo depois de o site estar no ar e substitua a DATA_ENCRYPTION_KEY, senão os CPFs já salvos deixam de abrir.
import { randomBytes } from "node:crypto";

const hex = (n) => randomBytes(n).toString("hex");
const sites = process.argv.includes("--sites");

if (sites) {
  console.log(`
# ───── Segredos novos para o ChatGPT Sites ─────
APP_SECRET="${hex(32)}"
CRON_SECRET="${hex(24)}"
DATA_ENCRYPTION_KEY="${randomBytes(32).toString("base64")}"
# ───────────────────────────────────────────────

1) Guarde estas 3 linhas AGORA no seu gerenciador de senhas (fora do ChatGPT).
2) Cadastre cada valor nas CONFIGURAÇÕES DO SITE no ChatGPT Sites, como segredo (secret).
3) NÃO crie um arquivo .env, NÃO cole isto numa conversa e NÃO anexe esta saída ao ChatGPT.
4) A DATA_ENCRYPTION_KEY só é usada na Fase 2 (carteira), mas gere e guarde já: nunca troque com o site no ar.
`);
} else {
  console.log(`
# ───── Segredos novos (copie para o .env do servidor) ─────
APP_SECRET="${hex(32)}"
DATA_ENCRYPTION_KEY="${randomBytes(32).toString("base64")}"
CRON_SECRET="${hex(24)}"
ASAAS_WEBHOOK_TOKEN="${hex(24)}"
ASAAS_TRANSFER_AUTH_TOKEN="${hex(24)}"
# ─────────────────────────────────────────────────────────

Guarde uma cópia destas linhas em um gerenciador de senhas (ou num arquivo fora do servidor).
A DATA_ENCRYPTION_KEY é a mais importante: sem ela os CPFs cifrados não são recuperáveis.
(No ChatGPT Sites use: npm run secrets -- --sites)
`);
}
