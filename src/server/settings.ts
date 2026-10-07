import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { audit } from "./audit";
import { requireActor, requireAdmin } from "./permissions";
import type { Actor } from "./types";

/**
 * Configurações que o admin altera pela interface (tabela SiteSetting).
 *  - wallet.enabled: liga/desliga a Carteira de equipe, os depósitos, os saques e os desafios valendo créditos.
 *    Só pode ser LIGADA com a configuração necessária pronta; ausente = ligada (comportamento de sempre).
 *  - withdraw.requireAdminApproval: TODO saque espera a liberação de um administrador. Ausente = exigida (padrão seguro).
 */
const K_WALLET = "wallet.enabled";
const K_WITHDRAW_ADMIN = "withdraw.requireAdminApproval";

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
  } else {
    const ok = !env.isProd || env.allowMockPix;
    items.push({ key: "pix", label: "Provedor de Pix", ok, hint: ok ? "Simulador de Pix (somente testes, não movimenta dinheiro real)." : "Em produção use PIX_PROVIDER=asaas: o simulador não movimenta dinheiro real." });
  }

  const keyOk = !env.isProd || env.dataEncryptionKey.length >= 32;
  items.push({ key: "encryption", label: "Criptografia dos CPFs", ok: keyOk, hint: keyOk ? "Chave de criptografia definida." : "Defina DATA_ENCRYPTION_KEY (32 bytes) e guarde um backup dela." });

  const cronOk = !env.isProd || env.cronSecret.length >= 24;
  items.push({ key: "cron", label: "Agendador dos saques", ok: cronOk, hint: cronOk ? "CRON_SECRET definido (o agendador chama /api/cron/wallet)." : "Defina CRON_SECRET (24+ caracteres) e agende a chamada de /api/cron/wallet." });

  const urlOk = !env.isProd || (env.appUrl.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(env.appUrl));
  items.push({ key: "url", label: "Endereço público do site (webhooks)", ok: urlOk, hint: urlOk ? "APP_URL público." : "Defina APP_URL com o endereço https:// público do site, para o provedor entregar os webhooks." });

  return { ready: items.every((i) => i.ok), items };
}

export interface WalletState {
  /** Desligada por variável de ambiente (WALLET_ENABLED=false): o admin não consegue religar pela interface. */
  envBlocked: boolean;
  /** A chave que o admin controla. */
  switchOn: boolean;
  readiness: WalletReadiness;
  /** O que os usuários realmente veem: chave ligada E configuração pronta. */
  effective: boolean;
  withdrawRequireAdmin: boolean;
}

export async function walletState(): Promise<WalletState> {
  const env = getEnv();
  const [wallet, wd] = await Promise.all([read(K_WALLET), read(K_WITHDRAW_ADMIN)]);
  const switchOn = wallet !== "false";
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
