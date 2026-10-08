import { db } from "../src/lib/db";
import { safeMailError } from "../src/server/mailer";
import { criarAdmin } from "./lib/criar-admin";

async function main() {
  const args = process.argv.slice(2);
  const reenviar = args.includes("--reenviar");
  const values = args.filter((arg) => arg !== "--reenviar");
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Use este comando dentro do container de produção (veja docs/LANCAMENTO_PRIMEARENA.md).");
  }
  if (values.length !== 3 || values.some((arg) => arg.startsWith("--"))) {
    throw new Error('Uso: npm run admin:criar -- EMAIL USUARIO "Nome" [--reenviar]');
  }
  await criarAdmin({ email: values[0], username: values[1], displayName: values[2] }, reenviar);
  console.log("Confirmação enviada ao SMTP. Confira a caixa de entrada e o spam; a entrega ainda precisa ser confirmada.");
  console.log("Abra o link recebido e defina sua senha. O cargo de administrador depende da confirmação do e-mail.");
}

main().catch((error) => {
  console.error(safeMailError(error));
  console.error("Se a conta ficou pendente após falha no envio, corrija o SMTP e repita com --reenviar.");
  process.exitCode = 1;
}).finally(() => db.$disconnect());
