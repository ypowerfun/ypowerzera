import { db } from "@/lib/db";

class DemoAccountsError extends Error {}

/**
 * Em produção, recusa subir se o banco tiver as contas de demonstração (@primearena.local): a senha delas está publicada no
 * README, então qualquer pessoa entraria como administrador. Acontece se alguém aponta o site para o banco de desenvolvimento.
 */
export async function assertNoDemoAccounts(): Promise<void> {
  try {
    const demo = await db.user.count({ where: { email: { endsWith: "@primearena.local" } } });
    if (demo > 0) {
      throw new DemoAccountsError(
        `O banco tem ${demo} conta(s) de demonstração (@primearena.local) com senha pública. Em produção use um banco NOVO e vazio ` +
          "(apague o arquivo do banco de desenvolvimento) e crie a sua conta de administrador pelo cadastro, com o e-mail de ADMIN_EMAILS.",
      );
    }
  } catch (e) {
    if (e instanceof DemoAccountsError) throw e;
    // Só "banco ainda sem as tabelas" (primeira subida) é aceitável; qualquer outro erro (banco fora do ar, coluna ausente…) NÃO
    // pode passar em silêncio, senão uma falha momentânea deixaria o site "confirmado" com contas de demonstração no banco.
    const msg = String((e as { message?: unknown })?.message ?? e);
    const code = (e as { code?: unknown })?.code;
    if (code !== "P2021" && !/no such table|does not exist/i.test(msg)) throw e;
  }
}
