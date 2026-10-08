import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// O build do ChatGPT Sites (Cloudflare Workers + D1) troca o banco e o cliente Prisma por versões compatíveis
// (veja next.config.ts). Marcamos isso aqui, porque este arquivo é lido por `opennextjs-cloudflare build`
// ANTES de o `next build` rodar (e o ambiente é herdado), qualquer que seja quem chame o comando.
process.env.PA_TARGET = "sites";

export default defineCloudflareConfig({});
