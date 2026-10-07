/**
 * Testa o envio de e-mail com as configurações do .env, sem subir o site:
 *   npm run mail:test -- voce@exemplo.com
 * Mostra se o SMTP_URL funciona e, se não, o motivo provável (sem expor a senha).
 */
import { sendTestMail } from "../src/server/mailer";

async function main() {
  const to = process.argv[2];
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error("Uso: npm run mail:test -- voce@exemplo.com");
    process.exitCode = 1;
    return;
  }
  console.log(`Enviando um e-mail de teste para ${to}…`);
  const r = await sendTestMail(to);
  if (r.ok) {
    console.log("✔ Enviado. Confira a caixa de entrada (e o spam). Se chegou, a confirmação de conta dos usuários também vai chegar.");
  } else {
    console.error(`✖ Não enviou.\n  ${r.error}`);
    process.exitCode = 1;
  }
}

main();
