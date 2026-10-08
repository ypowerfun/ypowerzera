/** Roda uma vez na subida do servidor: em produção, recusa iniciar com configuração perigosa. */
export async function register() {
  // no ChatGPT Sites (Workers) não há "subida do servidor": quem confere é o boot-guard, no primeiro pedido
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.PA_RUNTIME !== "sites") {
    const { assertProductionConfig } = await import("@/lib/env");
    assertProductionConfig();
    if (process.env.NODE_ENV === "production") {
      const { assertNoDemoAccounts } = await import("@/server/boot-checks");
      await assertNoDemoAccounts();
    }
  }
}
