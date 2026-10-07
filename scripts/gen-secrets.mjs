// Gera os segredos que o site precisa em produção. Não precisa de openssl: funciona igual no Windows, macOS e Linux.
//   npm run secrets
// Copie as linhas para o seu arquivo .env (e guarde uma cópia em lugar seguro: SEM a DATA_ENCRYPTION_KEY os CPFs
// já cifrados não podem ser recuperados). Cada execução gera valores novos: NÃO rode de novo depois de o site estar no ar
// e substitua a DATA_ENCRYPTION_KEY, senão os CPFs já salvos deixam de abrir.
import { randomBytes } from "node:crypto";

const hex = (n) => randomBytes(n).toString("hex");

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
`);
