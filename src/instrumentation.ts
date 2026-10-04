/** Roda uma vez na subida do servidor: em produção, recusa iniciar com configuração perigosa. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertProductionConfig } = await import("@/lib/env");
    assertProductionConfig();
  }
}
