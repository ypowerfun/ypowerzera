/** Leitura centralizada das variáveis de ambiente, com valores padrão seguros para desenvolvimento. */

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function int(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? Math.trunc(n) : def;
}

/** A chave de criptografia dos CPFs precisa render 32 bytes: 64 caracteres hex ou base64 que decodifique em 32+ bytes (igual a `masterSecret`). */
export function isValidDataEncryptionKey(key: string): boolean {
  const raw = /^[0-9a-f]{64}$/i.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "base64");
  return raw.length >= 32;
}

/** Rodando dentro do Cloudflare Workers? (defesa: se a variável PA_RUNTIME for esquecida, as regras do Sites valem do mesmo jeito) */
function inCloudflareWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

export type MailProvider = "resend" | "brevo" | "smtp" | "none";

function pickMailProvider(): MailProvider {
  const explicit = (process.env.MAIL_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "resend" || explicit === "brevo" || explicit === "smtp") return explicit;
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.SMTP_URL) return "smtp";
  return "none";
}

/** O provedor escolhido tem o que precisa para enviar? */
export function mailProviderReady(e: { mailProvider: MailProvider; smtpUrl: string; resendApiKey: string; brevoApiKey: string }): boolean {
  if (e.mailProvider === "resend") return !!e.resendApiKey;
  if (e.mailProvider === "brevo") return !!e.brevoApiKey;
  if (e.mailProvider === "smtp") return !!e.smtpUrl;
  return false;
}

export function getEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;
  return {
    isProd,
    isTest,
    appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    appSecret: process.env.APP_SECRET ?? "",
    /** "none" = sem pagamento de inscrição (campeonatos só gratuitos); a carteira por Pix é outro assunto (PIX_PROVIDER). */
    paymentsProvider: (process.env.PAYMENTS_PROVIDER ?? "mock") as "mock" | "stripe" | "none",
    allowMockPayments: bool(process.env.ALLOW_MOCK_PAYMENTS, false),
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    platformFeeBps: int(process.env.PLATFORM_FEE_BPS, 1000),
    reservationMinutes: int(process.env.RESERVATION_MINUTES, 30),
    mailFrom: process.env.MAIL_FROM ?? "Prime Arena <no-reply@primearena.local>",
    smtpUrl: process.env.SMTP_URL ?? "",
    /** E-mail por API HTTP (único tipo que funciona no ChatGPT Sites / Cloudflare Workers, que não falam SMTP). */
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    brevoApiKey: process.env.BREVO_API_KEY ?? "",
    /** Quem envia: MAIL_PROVIDER explícito ou, se vazio, o primeiro configurado (Resend, Brevo, SMTP). "none" = nada configurado. */
    mailProvider: pickMailProvider(),
    /** "sites" = rodando no ChatGPT Sites (Cloudflare Workers + D1). Definido pelo wrangler.jsonc; no servidor próprio fica "server". */
    /** SÓ no seu computador (npm run preview:sites / smoke:sites): aceita APP_URL http://localhost na prévia do Sites. Nunca defina no site de verdade. */
    localPreview: bool(process.env.PA_LOCAL_PREVIEW, false),
    runtime: (process.env.PA_RUNTIME === "sites" || inCloudflareWorkers() ? "sites" : "server") as "sites" | "server",
    adminEmails: (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    cronSecret: process.env.CRON_SECRET ?? "",
    dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY ?? "",
    pixProvider: (process.env.PIX_PROVIDER ?? "mock") as "mock" | "asaas" | "stripe",
    allowMockPix: bool(process.env.ALLOW_MOCK_PIX, false),
    asaasApiKey: process.env.ASAAS_API_KEY ?? "",
    asaasEnv: (process.env.ASAAS_ENV ?? "sandbox") as "sandbox" | "production",
    asaasWebhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? "",
    asaasTransferAuthToken: process.env.ASAAS_TRANSFER_AUTH_TOKEN ?? "",
    /** Pede o CPF do pagador na página de pagamento da Stripe. Desligue (false) se a Stripe recusar o pedido para Pix: todo depósito vai para o admin conferir. */
    stripePixCollectTaxId: bool(process.env.STRIPE_PIX_COLLECT_TAX_ID, true),
    /**
     * O CPF do pagador no Stripe é DIGITADO pelo próprio pagador (o Stripe não o confirma no banco): quem paga por outra pessoa pode
     * digitar o CPF do titular. Por isso, por padrão, TODO depósito pelo Stripe fica retido para o administrador conferir o nome do
     * pagador no painel do Stripe. Com `true` o depósito credita sozinho quando o CPF declarado confere com o titular de um KYC
     * VERIFICADO: mais cômodo, porém contornável. Ligue só se aceitar esse risco.
     */
    stripePixAutoCredit: bool(process.env.STRIPE_PIX_AUTO_CREDIT, false),
    /** Permite chave de TESTE (sk_test_) em produção, para ensaiar o fluxo do Stripe no site de verdade. Aparece como alerta no painel. */
    stripeAllowTestKey: bool(process.env.STRIPE_ALLOW_TEST_KEY, false),
    walletEnabled: bool(process.env.WALLET_ENABLED, true),
    payoutsPaused: bool(process.env.PAYOUTS_PAUSED, false),
    /** Com `true`, depósito cujo pagador o provedor não informou (ex.: Asaas) fica retido para o admin em vez de creditar. */
    // O Asaas não informa quem pagou o Pix (e o CPF da Stripe é opcional na página de pagamento): em produção, por padrão, TODO
    // depósito sem o CPF do pagador fica retido para o admin conferir (a regra "o pagador é o titular" não pode ficar desligada
    // por esquecimento). Defina PIX_REQUIRE_PAYER_DOC=false para desligar.
    pixRequirePayerDoc: bool(process.env.PIX_REQUIRE_PAYER_DOC, process.env.NODE_ENV === "production" && ["asaas", "stripe"].includes(process.env.PIX_PROVIDER ?? "mock")),
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
  if (env.trustProxy === null && env.runtime !== "sites") {
    problems.push("Defina TRUST_PROXY=true (atrás de proxy/CDN que sobrescreve x-forwarded-for) ou TRUST_PROXY=false. Sem isso o IP de origem poderia ser forjado para burlar os limites de tentativas.");
  }
  if (!["mock", "stripe", "none"].includes(env.paymentsProvider)) {
    problems.push(`PAYMENTS_PROVIDER="${env.paymentsProvider}" não existe: use stripe, none (sem pagamento de inscrição) ou, só para testes, mock.`);
  }
  if (env.paymentsProvider === "mock" && !env.allowMockPayments) {
    problems.push("PAYMENTS_PROVIDER=mock é recusado em produção (use stripe, ou none para campeonatos só gratuitos; ALLOW_MOCK_PAYMENTS=true não é recomendado).");
  }
  if (!/^https:\/\//i.test(env.appUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(env.appUrl)) {
    problems.push("APP_URL precisa ser o endereço público do site com https:// (ex.: https://meusite.com.br): ele vai nos links dos e-mails de confirmação e de redefinição de senha.");
  }
  if (!mailProviderReady(env)) {
    problems.push(
      env.runtime === "sites"
        ? "Configure o envio de e-mail por API: RESEND_API_KEY (ou BREVO_API_KEY). Sem isso nenhum e-mail de confirmação de conta sai e ninguém consegue confirmar o cadastro (veja docs/CONFIGURAR_EMAIL.md)."
        : "SMTP_URL (ou RESEND_API_KEY / BREVO_API_KEY) é obrigatório em produção: sem isso nenhum e-mail de confirmação de conta sai e ninguém consegue confirmar o cadastro (veja docs/CONFIGURAR_EMAIL.md).",
    );
  } else if (env.runtime === "sites" && env.mailProvider === "smtp") {
    problems.push("No ChatGPT Sites o SMTP não funciona (a hospedagem não abre conexões SMTP). Use RESEND_API_KEY ou BREVO_API_KEY.");
  }
  // Recusa o padrão de desenvolvimento (@primearena.local) e domínios reservados (.local/.invalid/.test) SÓ no final do endereço:
  // "app.test-arena.com.br" e "loja.local.com.br" são domínios legítimos.
  if (!process.env.MAIL_FROM?.trim() || /@[^\s>]*\.(local|invalid|test)\s*>?\s*$/i.test(env.mailFrom)) {
    problems.push('MAIL_FROM é obrigatório em produção e precisa ser um endereço do seu domínio (ex.: "Prime Arena <nao-responda@meusite.com.br>"); o padrão de desenvolvimento (@primearena.local) é recusado pelos provedores de e-mail.');
  }
  if (env.runtime === "sites") {
    // No Sites o endereço padrão (http://localhost:3000) deixaria os links dos e-mails e o agendador errados em silêncio.
    if (!env.localPreview && (!process.env.APP_URL || !/^https:\/\//i.test(env.appUrl) || /localhost|127\.0\.0\.1/.test(env.appUrl))) {
      problems.push("No ChatGPT Sites, defina APP_URL com o endereço público https:// do site (ex.: https://meusite.com.br): ele vai nos links dos e-mails de confirmação.");
    }
    if (env.cronSecret.length < 24) problems.push("No ChatGPT Sites, defina CRON_SECRET (24+ caracteres): sem ele o agendador (limpeza, Pix expirado, desafios) não roda.");
  }
  if (env.adminEmails.length === 0) {
    problems.push("ADMIN_EMAILS é obrigatório em produção: é assim que o seu e-mail vira administrador depois de confirmado (o seed de demonstração não roda em produção).");
  }
  // A Stripe pode servir às inscrições (PAYMENTS_PROVIDER) e/ou aos depósitos da carteira (PIX_PROVIDER): as mesmas chaves valem para os dois.
  const usesStripe = env.paymentsProvider === "stripe" || (env.walletEnabled && env.pixProvider === "stripe");
  if (usesStripe && (!env.stripeSecretKey || !env.stripeWebhookSecret)) {
    problems.push("STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET são obrigatórios com PAYMENTS_PROVIDER=stripe ou PIX_PROVIDER=stripe.");
  }
  if (usesStripe && /^[sr]k_test_/.test(env.stripeSecretKey) && !env.stripeAllowTestKey) {
    problems.push("STRIPE_SECRET_KEY é uma chave de TESTE (sk_test_…): um site público não receberia dinheiro de verdade. Use a chave sk_live_… da Stripe (ou, só para ensaiar o fluxo, defina STRIPE_ALLOW_TEST_KEY=true e lembre de trocar depois).");
  }
  if (!["mock", "asaas", "stripe"].includes(env.pixProvider)) {
    problems.push(`PIX_PROVIDER="${env.pixProvider}" não existe: use asaas ou stripe (ou, só para testes, mock).`);
  }
  if (env.walletEnabled) {
    if (!isValidDataEncryptionKey(env.dataEncryptionKey)) problems.push("DATA_ENCRYPTION_KEY (32 bytes em base64/hex) é obrigatório para proteger o CPF dos usuários.");
    if (env.pixProvider === "mock" && !env.allowMockPix) problems.push("PIX_PROVIDER=mock é recusado em produção (use asaas ou stripe).");
    if (env.pixProvider === "asaas" && (!env.asaasApiKey || !env.asaasWebhookToken || !env.asaasTransferAuthToken)) {
      problems.push("ASAAS_API_KEY, ASAAS_WEBHOOK_TOKEN e ASAAS_TRANSFER_AUTH_TOKEN são obrigatórios com PIX_PROVIDER=asaas.");
    }
    if (env.cronSecret.length < 24) problems.push("CRON_SECRET (24+ caracteres) é obrigatório para os jobs de saque/depósito.");
  }
  if (problems.length) throw new Error(`Configuração de produção inválida:\n- ${problems.join("\n- ")}`);
}
