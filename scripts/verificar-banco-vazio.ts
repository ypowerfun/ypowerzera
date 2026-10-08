import { db } from "../src/lib/db";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Defina DATABASE_URL explicitamente antes da verificação.");
  const total = await db.user.count();
  console.log(`Contas cadastradas: ${total}`);
  if (total !== 0) {
    console.error("O banco contém contas. Nenhum dado foi apagado. Inspecione o banco e faça backup antes de qualquer limpeza.");
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("Não foi possível verificar o banco. Confira DATABASE_URL e se as tabelas já foram criadas.");
  process.exitCode = 1;
}).finally(() => db.$disconnect());
