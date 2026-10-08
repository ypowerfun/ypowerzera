import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// O build do ChatGPT Sites (Cloudflare Workers + D1) troca o banco e o cliente Prisma por versões compatíveis
// (veja next.config.ts). Marcamos isso aqui, porque este arquivo é lido por `opennextjs-cloudflare build`
// ANTES de o `next build` rodar (e o ambiente é herdado), qualquer que seja quem chame o comando.
process.env.PA_TARGET = "sites";

const config = defineCloudflareConfig({});
// Passo "next build" próprio (scripts/next-build-sites.mjs): recusa .env no disco (os segredos não podem ir para o pacote) e, depois
// do build, limpa as listas de rastreio para o Worker caber nos limites da Cloudflare.
config.buildCommand = "node scripts/next-build-sites.mjs";
export default config;
