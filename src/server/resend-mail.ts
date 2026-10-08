import { randomUUID } from "node:crypto";
import type { MailMessage } from "./mailer";

/** HTTP only: no SMTP socket, filesystem outbox, or secret in diagnostics. */
export async function sendResendMail(msg: MailMessage, apiKey: string, from: string): Promise<void> {
  const idempotencyKey = randomUUID();
  const body = JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text });
  for (let attempt = 0; attempt < 3; attempt++) {
    let retry = false;
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return;
      // Never relay provider response bodies: they may contain addresses or request data.
      retry = response.status === 429 || response.status >= 500;
      if (!retry || attempt === 2) throw new Error(`Falha no envio de e-mail (HTTP ${response.status}).`);
      await response.body?.cancel();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Falha no envio")) throw error;
      retry = true;
      if (attempt === 2) throw new Error("O serviço de e-mail não respondeu. Tente novamente em instantes.");
    }
    if (retry) await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  }
}
