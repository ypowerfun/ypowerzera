import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv, mailProviderReady } from "@/lib/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Caixa de saída em memória, usada pelos testes. */
export const testOutbox: MailMessage[] = [];

/** Hosts em que o servidor de e-mail é da própria máquina (sem TLS): só nesses casos a produção aceita enviar sem TLS. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Opções do envio por SMTP: tempos limite curtos (um SMTP travado não pode segurar a requisição do usuário por minutos) e,
 * em produção, TLS obrigatório (a senha do SMTP nunca trafega em texto puro), salvo servidor da própria máquina.
 */
export function smtpTransportOptions(smtpUrl: string, isProd: boolean) {
  let host = "";
  try {
    host = new URL(smtpUrl).hostname.toLowerCase();
  } catch {
    /* URL inválida: o nodemailer reclama na hora de enviar, com mensagem clara */
  }
  return {
    url: smtpUrl,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(isProd && !LOCAL_HOSTS.has(host) ? { requireTLS: true } : {}),
  };
}

/** Texto do erro do SMTP sem a senha (a URL do SMTP traz usuário e senha). Útil para mostrar ao admin e para os logs. */
export function safeMailError(e: unknown): string {
  const raw = e instanceof Error ? `${e.message}` : String(e);
  const { smtpUrl, resendApiKey, brevoApiKey } = getEnv();
  let out = raw;
  for (const key of [resendApiKey, brevoApiKey]) if (key.length >= 8) out = out.split(key).join("***");
  try {
    const u = new URL(smtpUrl);
    for (const secret of [u.password, decodeURIComponent(u.password), u.username, decodeURIComponent(u.username)]) {
      if (secret && secret.length >= 3) out = out.split(secret).join("***");
    }
  } catch {
    /* sem URL válida, nada a esconder */
  }
  return out.slice(0, 300);
}

/** "Nome <email@dominio>" → { name, email } (o MAIL_FROM no formato do .env). */
export function parseMailFrom(from: string): { name: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^<>\s]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: "", email: from.trim() };
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "prime-arena", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // o corpo do erro costuma dizer o motivo ("domain not verified"); nunca inclui a nossa chave, e safeMailError ainda a esconde
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`${label} respondeu ${res.status}: ${detail}`);
  }
}

/** Resend (https://resend.com): POST /emails com a chave no Authorization. */
export async function sendViaResend(msg: MailMessage): Promise<void> {
  const env = getEnv();
  await postJson("https://api.resend.com/emails", { Authorization: `Bearer ${env.resendApiKey}` }, { from: env.mailFrom, to: [msg.to], subject: msg.subject, text: msg.text }, "Resend");
}

/** Brevo (https://brevo.com): POST /v3/smtp/email com a chave no cabeçalho api-key. */
export async function sendViaBrevo(msg: MailMessage): Promise<void> {
  const env = getEnv();
  const from = parseMailFrom(env.mailFrom);
  await postJson(
    "https://api.brevo.com/v3/smtp/email",
    { "api-key": env.brevoApiKey, accept: "application/json" },
    { sender: from.name ? { name: from.name, email: from.email } : { email: from.email }, to: [{ email: msg.to }], subject: msg.subject, textContent: msg.text },
    "Brevo",
  );
}

/**
 * Envia e-mail. Com RESEND_API_KEY/BREVO_API_KEY usa a API do provedor (obrigatório no ChatGPT Sites); com SMTP_URL usa nodemailer; sem SMTP grava em .dev-mail/ e imprime no console
 * (nunca envia nada de verdade em desenvolvimento).
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  const env = getEnv();
  if (env.isTest) {
    testOutbox.push(msg);
    return;
  }
  if (env.mailProvider === "resend" && env.resendApiKey) return sendViaResend(msg);
  if (env.mailProvider === "brevo" && env.brevoApiKey) return sendViaBrevo(msg);
  if (env.mailProvider === "smtp" && env.smtpUrl) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(smtpTransportOptions(env.smtpUrl, env.isProd));
    await transport.sendMail({ from: env.mailFrom, to: msg.to, subject: msg.subject, text: msg.text });
    return;
  }
  if (env.isProd) console.warn(`[mail] Nenhum envio de e-mail configurado (SMTP_URL, RESEND_API_KEY ou BREVO_API_KEY): e-mail para ${msg.to} ("${msg.subject}") não foi enviado.`);
  const dir = path.join(process.cwd(), ".dev-mail");
  await mkdir(dir, { recursive: true });
  const safe = msg.to.replace(/[^a-z0-9@._-]/gi, "_");
  await writeFile(path.join(dir, `${Date.now()}-${safe}.txt`), `Para: ${msg.to}\nAssunto: ${msg.subject}\n\n${msg.text}\n`);
  console.log(`\n[mail → ${msg.to}] ${msg.subject}\n${msg.text}\n`);
}

/**
 * Teste de envio para o admin conferir o SMTP. Devolve `{ ok: true }` ou `{ ok: false, error }` com um texto que ajuda a
 * achar o problema (sem a senha). Sem SMTP configurado, avisa em vez de "fingir" que enviou.
 */
export async function sendTestMail(to: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const env = getEnv();
  if (!mailProviderReady(env) && !env.isTest) {
    return { ok: false, error: "O envio de e-mail não está configurado (RESEND_API_KEY, BREVO_API_KEY ou SMTP_URL). Sem ele nenhum e-mail sai (nem a confirmação de conta). Veja docs/CONFIGURAR_EMAIL.md." };
  }
  try {
    await sendMail({
      to,
      subject: "Teste de e-mail — Prime Arena",
      text: "Se você recebeu esta mensagem, o envio de e-mails do site está funcionando: a confirmação de conta e a recuperação de senha vão chegar aos usuários.\n\nPode apagar este e-mail.",
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: hintForMailError(safeMailError(e)) };
  }
}

/** Traduz os erros mais comuns do SMTP em um conselho prático. */
export function hintForMailError(message: string): string {
  const m = message.toLowerCase();
  let hint = "";
  if (/(resend|brevo) respondeu (401|403)|api key|api-key|invalid_api_key|unauthorized/.test(m)) hint = "A chave da API de e-mail foi recusada: confira RESEND_API_KEY / BREVO_API_KEY (copie de novo, sem espaços).";
  else if (/(resend|brevo) respondeu (400|422)|domain|not verified|sender.*(invalid|not valid)|unverified/.test(m) && /resend|brevo/.test(m)) hint = "O provedor recusou o remetente: verifique o domínio no painel do provedor e use um MAIL_FROM desse domínio (docs/CONFIGURAR_EMAIL.md).";
  else if (/(resend|brevo) respondeu 429|rate|quota|limit/.test(m) && /resend|brevo/.test(m)) hint = "Limite de envios do plano do provedor atingido: espere ou aumente o plano.";
  else if (/535|invalid login|authentication|auth.*fail|username and password not accepted/.test(m)) hint = "Usuário ou senha do SMTP recusados: confira o SMTP_URL (e, no Gmail, use uma senha de app).";
  else if (/econnrefused|enotfound|getaddrinfo|eai_again/.test(m)) hint = "Não consegui conectar ao servidor de e-mail: confira o endereço e a porta do SMTP_URL.";
  else if (/etimedout|timeout|timed out|esocket/.test(m)) hint = "O servidor de e-mail não respondeu a tempo: a porta pode estar bloqueada pela hospedagem (tente a 587 ou a 465).";
  else if (/tls|ssl|certificate|wrong version number|starttls/.test(m)) hint = "Falha de TLS: tente smtps:// com a porta 465 (ou smtp:// com a 587), conforme o seu provedor.";
  else if (/sender|from address|not verified|unverified|550|553|554/.test(m)) hint = "O remetente (MAIL_FROM) foi recusado: o e-mail/domínio de envio precisa estar verificado no seu provedor.";
  return hint ? `${hint} (detalhe: ${message})` : message;
}

export function lastMailTo(to: string): MailMessage | undefined {
  return [...testOutbox].reverse().find((m) => m.to === to);
}
