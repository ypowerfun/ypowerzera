/** Erro de regra de negócio com mensagem segura para exibir ao usuário. */
export class AppError extends Error {
  constructor(
    message: string,
    public code: "VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMIT" | "UNAUTHENTICATED" = "VALIDATION",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
