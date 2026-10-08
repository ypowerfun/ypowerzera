import { db, engineHealth } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv, isValidDataEncryptionKey, mailProviderReady } from "@/lib/env";
import { audit } from "./audit";
import { sendTestMail } from "./mailer";
import { requireActor, requireAdmin } from "./permissions";
import { rateLimit } from "./rate-limit";
import type { Actor } from "./types";

/**
 * Configurações que o admin altera pela interface (tabela SiteSetting).
 *  - wallet.enabled: liga/desliga a Carteira de equipe, os depósitos, os saques e os desafios valendo créditos.
 *    Só pode ser LIGADA com a configuração necessária pronta. Nunca tocada: em PRODUÇÃO fica DESLIGADA (o admin liga com o botão "Ativar a carteira");
 *    fora de produção (desenvolvimento e testes) fica ligada.
 *  - withdraw.requireAdminApproval: TODO saque espera a liberação de um administrador. Ausente = exigida (padrão seguro).
 */
const K_WALLET = "wallet.enabled";
const K_WITHDRAW_ADMIN = "withdraw.requireAdminApproval";
const K_CRON_LAST = "cron.lastRunAt";

async function read(key: string): Promise<string | null> {
  return (await db.siteSetting.findUnique({ where: { key } }))?.value ?? null;
}

async function write(key: string, value: string, actorId: string): Promise<void> {
  await db.siteSetting.upsert({ where: { key }, create: { key, value, updatedById: actorId }, update: { value, updatedById: actorId } });
}

export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  /** O que está certo (quando ok) ou o que falta (quando não). */
  hint: string;
}

export interface WalletReadiness {
  ready: boolean;
  items: ReadinessItem[];
}

/** Checklist da configuração necessária para a carteira operar (depende só do ambiente do servidor). */
export function walletReadiness(): WalletReadiness {
  const env = getEnv();
  const items: ReadinessItem[] = [];

  const asaasOk = !!env.asaasApiKey && !!env.asaasWebhookToken && !!env.asaasTransferAuthToken;
  if (env.pixProvider === "asaas") {
    items.push({ key: "pix", label: "Provedor de Pix (Asaas)", ok: asaasOk, hint: asaasOk ? `Asaas em ${env.asaasEnv === "production" ? "produção" : "sandbox"}.` : "Defina ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN e ASAAS_TRANSFER_AUTH_TOKEN." });
  } else if (env.pixProvider === "stripe") {
    const ok = !!env.stripeSecretKey && !!env.stripeWebhookSecret;
    items.push({ key: "pix", label: "Provedor de Pix (Stripe)", ok, hint: ok ? "Depósitos pela Stripe; os saques são pagos à mão pelo administrador." : "Defina STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET." });
  } else {
    const ok = !env.isProd || env.allowMockPix;
    items.push({ key: "pix", label: "Provedor de Pix", ok, hint: ok ? "Simulador de Pix (somente testes, não movimenta dinheiro real)." : "Em produção use PIX_PROVIDER=asaas ou stripe: o simulador não movimenta dinheiro real." });
  }

  const keyOk = !env.isProd || isValidDataEncryptionKey(env.dataEncryptionKey);
  items.push({ key: "encryption", label: "Criptografia dos CPFs", ok: keyOk, hint: keyOk ? "Chave de criptografia definida." : "Defina DATA_ENCRYPTION_KEY com 32 bytes (64 caracteres hex ou base64) e guarde um backup dela." });

  const cronOk = !env.isProd || env.cronSecret.length >= 24;
  items.push({ key: "cron", label: "Agendador dos saques", ok: cronOk, hint: cronOk ? "CRON_SECRET definido (o agendador chama /api/cron/wallet)." : "Defina CRON_SECRET (24+ caracteres) e agende a chamada de /api/cron/wallet." });

  const urlOk = !env.isProd || (env.appUrl.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(env.appUrl));
  items.push({ key: "url", label: "Endereço público do site (webhooks)", ok: urlOk, hint: urlOk ? "APP_URL público." : "Defina APP_URL com o endereço https:// público do site, para o provedor entregar os webhooks." });

  return { ready: items.every((i) => i.ok), items };
}

export interface WalletState {
  /** Desligada por variável de ambiente (WALLET_ENABLED=false): o admin não consegue religar pela interface. */
  envBlocked: boolean;
  /** A chave que o admin controla (em produção, enquanto ele não a ligar, fica desligada). */
  switchOn: boolean;
  readiness: WalletReadiness;
  /** O que os usuários realmente veem: chave ligada E configuração pronta. */
  effective: boolean;
  withdrawRequireAdmin: boolean;
}

export async function walletState(): Promise<WalletState> {
  const env = getEnv();
  const [wallet, wd] = await Promise.all([read(K_WALLET), read(K_WITHDRAW_ADMIN)]);
  // Chave nunca tocada pelo admin: em PRODUÇÃO nasce DESLIGADA (ligar exige o clique em "Ativar a carteira", depois de a configuração
  // estar pronta); em desenvolvimento e nos testes nasce ligada. Assim, salvar a última variável da Fase 2 nunca expõe o dinheiro sozinho.
  const switchOn = wallet === null ? !env.isProd : wallet !== "false";
  const readiness = walletReadiness();
  return { envBlocked: !env.walletEnabled, switchOn, readiness, effective: env.walletEnabled && switchOn && readiness.ready, withdrawRequireAdmin: wd !== "false" };
}

/** A carteira (aba, depósitos, saques e desafios) está disponível para os usuários agora? */
export async function isWalletOn(): Promise<boolean> {
  return (await walletState()).effective;
}

/** Barra NOVAS operações de dinheiro quando a carteira está desligada. O que já está em andamento segue seu curso. */
export async function assertWalletOn(): Promise<void> {
  const s = await walletState();
  if (!s.effective) {
    throw new AppError(s.envBlocked || !s.switchOn ? "A carteira está desativada no momento." : "A carteira ainda não está disponível: a configuração está incompleta.", "FORBIDDEN");
  }
}

/** Todo saque precisa de liberação de um administrador? (padrão: sim) */
export async function withdrawalsNeedAdminApproval(): Promise<boolean> {
  return (await read(K_WITHDRAW_ADMIN)) !== "false";
}

export async function setWalletEnabled(actorIn: Actor | null, enabled: boolean): Promise<void> {
  const actor = requireActor(actorIn);
  requireAdmin(actor);
  if (enabled) {
    if (!getEnv().walletEnabled) throw new AppError("A carteira está desligada por variável de ambiente (WALLET_ENABLED=false). Ajuste o servidor para poder ligá-la.", "FORBIDDEN");
    const r = walletReadiness();
    if (!r.ready) throw new AppError(`Termine as configurações antes de ativar: ${r.items.filter((i) => !i.ok).map((i) => i.label).join(", ")}.`, "FORBIDDEN");
  }
  await write(K_WALLET, enabled ? "true" : "false", actor.id);
  await audit(actor.id, "settings.wallet", "SiteSetting", K_WALLET, { enabled });
}

export async function setWithdrawalsNeedAdminApproval(actorIn: Actor | null, required: boolean): Promise<void> {
  const actor = requireActor(actorIn);
  requireAdmin(actor);
  await write(K_WITHDRAW_ADMIN, required ? "true" : "false", actor.id);
  await audit(actor.id, "settings.withdraw_admin_approval", "SiteSetting", K_WITHDRAW_ADMIN, { required });
}

// ───────── Verificação do site (a lista que o admin vê em Configurações) ─────────

/** O agendador (/api/cron/wallet) chama isto a cada rodada: é como o admin enxerga que ele está funcionando. */
export async function markCronRun(now = new Date()): Promise<void> {
  const value = now.toISOString();
  await db.siteSetting.upsert({ where: { key: K_CRON_LAST }, create: { key: K_CRON_LAST, value }, update: { value } });
}

const CRON_STALE_MINUTES = 15;

function agoLabel(from: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return `há ${Math.round(min / 1440)} dias`;
}

/** O que precisa estar certo para o site funcionar de verdade na internet. Cada item diz o que está bem ou o que falta. */
export async function siteHealth(now = new Date()): Promise<ReadinessItem[]> {
  const env = getEnv();
  const items: ReadinessItem[] = [];

  const urlOk = env.appUrl.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(env.appUrl);
  items.push({ key: "url", label: "Endereço público com https", ok: urlOk, hint: urlOk ? `Os links dos e-mails usam ${env.appUrl}.` : `APP_URL está como ${env.appUrl}. Em produção use o endereço https:// do site, senão os links dos e-mails ficam errados.` });

  const smtpOk = mailProviderReady(env);
  const viaLabel = { resend: "Resend", brevo: "Brevo", smtp: "SMTP", none: "" }[env.mailProvider];
  items.push({ key: "smtp", label: "E-mail de confirmação de conta", ok: smtpOk, hint: smtpOk ? `Envio configurado (${viaLabel}); remetente: ${env.mailFrom}. Use o botão abaixo para testar.` : "Nenhum envio de e-mail configurado (RESEND_API_KEY, BREVO_API_KEY ou SMTP_URL): ninguém recebe o e-mail de confirmação (docs/CONFIGURAR_EMAIL.md)." });

  // ChatGPT Sites: o motor de transações do D1 deve estar limpo (nada na quarentena, nenhuma transação interrompida esperando)
  const engine = await engineHealth().catch(() => null);
  if (engine) {
    const ok = engine.dead === 0 && !engine.staleLease;
    items.push({
      key: "d1",
      label: "Banco do Sites (transações)",
      ok,
      hint: ok
        ? engine.pending > 0
          ? `${engine.pending} operação(ões) em andamento agora.`
          : "Tudo certo: nenhuma transação interrompida."
        : engine.dead > 0
          ? `${engine.dead} registro(s) em quarentena (_JournalDead): uma transação não pôde ser desfeita. Confira a conciliação da carteira e peça ajuda (docs/SITES.md, Apêndice A).`
          : "Uma transação foi interrompida e será desfeita sozinha na próxima operação de escrita.",
    });
  }

  const lastRaw = await read(K_CRON_LAST);
  const last = lastRaw ? new Date(lastRaw) : null;
  const cronOk = !!last && !Number.isNaN(last.getTime()) && now.getTime() - last.getTime() <= CRON_STALE_MINUTES * 60_000;
  items.push({
    key: "cron",
    label: "Agendador (saques, Pix expirado, desafios)",
    ok: cronOk,
    hint: cronOk ? `Rodou ${agoLabel(last!, now)}.` : last ? `Parado: a última rodada foi ${agoLabel(last, now)}. Sem ele os saques aprovados não saem e os Pix expirados não são limpos.` : env.runtime === "sites" ? "Ainda não rodou. No ChatGPT Sites ele depende do Cron do Cloudflare (já configurado no wrangler.jsonc) ou de um serviço externo (docs/SITES.md, seção 5). Na Fase 1 (campeonatos grátis) isto só atrasa a limpeza de sessões e links vencidos." : "Ainda não rodou. Ele precisa chamar /api/cron/wallet a cada 1 a 5 minutos (já vem pronto no docker-compose).",
  });

  const payOk = env.paymentsProvider === "none" || env.paymentsProvider === "stripe" || !env.isProd;
  const payHint = env.paymentsProvider === "none" ? "Sem pagamento de inscrição: os campeonatos são gratuitos." : env.paymentsProvider === "stripe" ? "Stripe configurado para as inscrições pagas." : env.isProd ? "O pagamento simulado não pode ficar ligado em produção." : "Pagamento simulado (só testes).";
  items.push({ key: "payments", label: "Pagamento de inscrição em campeonato", ok: payOk, hint: payHint });

  const secretOk = env.appSecret.length >= 32 && !env.appSecret.includes("troque") && !env.appSecret.includes("dev-only");
  items.push({ key: "secret", label: "Chave secreta do site (APP_SECRET)", ok: secretOk || !env.isProd, hint: secretOk ? "Definida." : "Defina uma APP_SECRET forte (rode: npm run secrets)." });

  // Chave de TESTE do Stripe liberada em produção (STRIPE_ALLOW_TEST_KEY): só serve para ensaiar num site separado. Nunca em site com usuários de verdade.
  const stripeForWallet = env.walletEnabled && env.pixProvider === "stripe";
  if (env.isProd && env.stripeAllowTestKey && /^[sr]k_test_/.test(env.stripeSecretKey) && (stripeForWallet || env.paymentsProvider === "stripe")) {
    items.push({
      key: "stripe-test",
      label: "Chave de TESTE do Stripe em uso",
      ok: false,
      hint: `O site está usando sk_test_ com STRIPE_ALLOW_TEST_KEY=true${stripeForWallet ? ": os créditos deste ensaio valem como dinheiro real na carteira" : ": os pagamentos de inscrição não são de verdade"}. Use só num site de ensaio sem usuários de verdade; no site definitivo troque por sk_live_ e APAGUE STRIPE_ALLOW_TEST_KEY (docs/CONFIGURAR_PIX.md, seção 10).`,
    });
  }

  const proxyOk = env.trustProxy !== null || env.runtime === "sites";
  items.push({ key: "proxy", label: "IP de origem dos visitantes (TRUST_PROXY)", ok: proxyOk || !env.isProd, hint: env.runtime === "sites" ? "ChatGPT Sites: o IP real vem da Cloudflare (cf-connecting-ip), que o visitante não consegue forjar." : proxyOk ? (env.trustProxy ? "Confiando no proxy (Caddy): os limites de tentativa valem por visitante." : "Ignorando x-forwarded-for: todos caem no mesmo limite.") : "Defina TRUST_PROXY=true quando houver um proxy como o Caddy na frente." });

  return items;
}

/** Botão "Enviar e-mail de teste" (Admin → Configurações): manda uma mensagem para o próprio admin e diz o que deu errado. */
export async function sendTestMailToAdmin(actorIn: Actor | null): Promise<void> {
  const actor = requireActor(actorIn);
  requireAdmin(actor);
  if (!actor.email) throw new AppError("Sua conta não tem e-mail cadastrado.");
  await rateLimit(`mail-test:${actor.id}`, 5, 3600, "Muitos testes seguidos. Aguarde alguns minutos.");
  const r = await sendTestMail(actor.email);
  await audit(actor.id, "settings.mail_test", "SiteSetting", "mail", { ok: r.ok });
  if (!r.ok) throw new AppError(`Não foi possível enviar: ${r.error}`);
}
