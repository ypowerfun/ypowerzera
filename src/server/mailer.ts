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
    const transport = nodemailer.createTransport(env.smtpUrl);
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

export function lastMailTo(to: string): MailMessage | undefined {
  return [...testOutbox].reverse().find((m) => m.to === to);
}
