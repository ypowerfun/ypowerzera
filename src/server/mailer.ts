import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/env";

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
  const { smtpUrl } = getEnv();
  let out = raw;
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

/**
 * Envia e-mail. Com SMTP_URL usa nodemailer; sem SMTP grava em .dev-mail/ e imprime no console
 * (nunca envia nada de verdade em desenvolvimento).
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  const env = getEnv();
  if (env.isTest) {
    testOutbox.push(msg);
    return;
  }
  if (env.smtpUrl) {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(smtpTransportOptions(env.smtpUrl, env.isProd));
    await transport.sendMail({ from: env.mailFrom, to: msg.to, subject: msg.subject, text: msg.text });
    return;
  }
  if (env.isProd) console.warn(`[mail] SMTP_URL não configurado: e-mail para ${msg.to} ("${msg.subject}") não foi enviado.`);
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
  if (!env.smtpUrl && !env.isTest) {
    return { ok: false, error: "O SMTP_URL não está configurado. Sem ele nenhum e-mail sai (nem a confirmação de conta). Veja docs/CONFIGURAR_EMAIL.md." };
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
  if (/535|invalid login|authentication|auth.*fail|username and password not accepted/.test(m)) hint = "Usuário ou senha do SMTP recusados: confira o SMTP_URL (e, no Gmail, use uma senha de app).";
  else if (/econnrefused|enotfound|getaddrinfo|eai_again/.test(m)) hint = "Não consegui conectar ao servidor de e-mail: confira o endereço e a porta do SMTP_URL.";
  else if (/etimedout|timeout|timed out|esocket/.test(m)) hint = "O servidor de e-mail não respondeu a tempo: a porta pode estar bloqueada pela hospedagem (tente a 587 ou a 465).";
  else if (/tls|ssl|certificate|wrong version number|starttls/.test(m)) hint = "Falha de TLS: tente smtps:// com a porta 465 (ou smtp:// com a 587), conforme o seu provedor.";
  else if (/sender|from address|not verified|unverified|550|553|554/.test(m)) hint = "O remetente (MAIL_FROM) foi recusado: o e-mail/domínio de envio precisa estar verificado no seu provedor.";
  return hint ? `${hint} (detalhe: ${message})` : message;
}

export function lastMailTo(to: string): MailMessage | undefined {
  return [...testOutbox].reverse().find((m) => m.to === to);
}
