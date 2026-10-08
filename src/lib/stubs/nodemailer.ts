// Substitui o nodemailer no build do ChatGPT Sites (next.config.ts): lá não existe conexão SMTP.
// O e-mail sai por RESEND_API_KEY ou BREVO_API_KEY (src/server/mailer.ts) e este arquivo nunca deveria ser chamado.
export function createTransport(): never {
  throw new Error("SMTP não funciona no ChatGPT Sites. Configure RESEND_API_KEY ou BREVO_API_KEY (docs/CONFIGURAR_EMAIL.md).");
}
export default { createTransport };
