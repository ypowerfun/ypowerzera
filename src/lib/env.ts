/** Leitura centralizada das variáveis de ambiente, com valores padrão seguros para desenvolvimento. */

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function int(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? Math.trunc(n) : def;
}

export function getEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;
  return {
    isProd,
    isTest,
    appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    appSecret: process.env.APP_SECRET ?? "",
    paymentsProvider: (process.env.PAYMENTS_PROVIDER ?? "mock") as "mock" | "stripe",
    allowMockPayments: bool(process.env.ALLOW_MOCK_PAYMENTS, false),
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    platformFeeBps: int(process.env.PLATFORM_FEE_BPS, 1000),
    reservationMinutes: int(process.env.RESERVATION_MINUTES, 30),
    mailFrom: process.env.MAIL_FROM ?? "Ypowerzera <no-reply@primearena.local>",
    smtpUrl: process.env.SMTP_URL ?? "",
    adminEmails: (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    cronSecret: process.env.CRON_SECRET ?? "",
    dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY ?? "",
    pixProvider: (process.env.PIX_PROVIDER ?? "mock") as "mock" | "asaas",
    allowMockPix: bool(process.env.ALLOW_MOCK_PIX, false),
    asaasApiKey: process.env.ASAAS_API_KEY ?? "",
    asaasEnv: (process.env.ASAAS_ENV ?? "sandbox") as "sandbox" | "production",
    asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? "",
    asaasTransferAuthToken: process.env.ASAAS_TRANSFER_AUTH_TOKEN ?? "",
    walletEnabled: bool(process.env.WALLET_ENABLED, true),
    payoutsPaused: bool(process.env.PAYOUTS_PAUSED, false),
    /** Só confie em x-forwarded-for se houver um proxy/CDN seu na frente que SOBRESCREVE o cabeçalho. */
    trustProxy: process.env.TRUST_PROXY === undefined || process.env.TRUST_PROXY === "" ? null : bool(process.env.TRUST_PROXY),
  };
}

/** Falha cedo, em produção, quando a configuração é perigosa. */
export function assertProductionConfig() {
  const env = getEnv();
  if (!env.isProd) return;
  const problems: string[] = [];
  if (env.appSecret.length < 32 || env.appSecret.includes("troque") || env.appSecret.includes("dev-only")) {
    problems.push("APP_SECRET precisa ter pelo menos 32 caracteres e não pode ser o valor de exemplo.");
  }
  if (env.trustProxy === null) {
    problems.push("Defina TRUST_PROXY=true (atrás de proxy/CDN que sobrescreve x-forwarded-for) ou TRUST_PROXY=false. Sem isso o IP de origem poderia ser forjado para burlar os limites de tentativas.");
  }
  if (env.paymentsProvider === "mock" && !env.allowMockPayments) {
    problems.push("PAYMENTS_PROVIDER=mock é recusado em produção (use stripe ou defina ALLOW_MOCK_PAYMENTS=true, não recomendado).");
  }
  if (env.paymentsProvider === "stripe" && (!env.stripeSecretKey || !env.stripeWebhookSecret)) {
    problems.push("STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET são obrigatórios com PAYMENTS_PROVIDER=stripe.");
  }
  if (env.walletEnabled) {
    if (env.dataEncryptionKey.length < 32) problems.push("DATA_ENCRYPTION_KEY (32 bytes em base64/hex) é obrigatório para proteger o CPF dos usuários.");
    if (env.pixProvider === "mock" && !env.allowMockPix) problems.push("PIX_PROVIDER=mock é recusado em produção (use asaas).");
    if (env.pixProvider === "asaas" && (!env.asaasApiKey || !env.asaasWebhookToken || !env.asaasTransferAuthToken)) {
      problems.push("ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN e ASAAS_TRANSFER_AUTH_TOKEN são obrigatórios com PIX_PROVIDER=asaas.");
    }
    if (env.cronSecret.length < 24) problems.push("CRON_SECRET (24+ caracteres) é obrigatório para os jobs de saque/depósito.");
  }
  if (problems.length) throw new Error(`Configuração de produção inválida:\n- ${problems.join("\n- ")}`);
}
