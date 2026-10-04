import type { Tournament } from "@prisma/client";

type T = Pick<Tournament, "status" | "registrationOpensAt" | "registrationClosesAt" | "checkInOpensAt" | "checkInClosesAt" | "startsAt">;

export type Window = "not_open" | "open" | "closed";

/** A inscrição está aberta? Depende do status e das datas. */
export function registrationWindow(t: T, now = new Date()): Window {
  if (t.status !== "REGISTRATION" && t.status !== "CHECK_IN") return t.status === "DRAFT" ? "not_open" : "closed";
  if (t.registrationOpensAt && now < t.registrationOpensAt) return "not_open";
  if (t.registrationClosesAt && now > t.registrationClosesAt) return "closed";
  return "open";
}

/** O check-in está aberto? O organizador pode abrir manualmente (status CHECK_IN) ou pelas datas. */
export function checkInWindow(t: T, now = new Date()): Window {
  if (t.status === "CHECK_IN") return "open";
  if (t.status !== "REGISTRATION") return "closed";
  if (!t.checkInOpensAt) return "not_open";
  if (now < t.checkInOpensAt) return "not_open";
  if (t.checkInClosesAt && now > t.checkInClosesAt) return "closed";
  return "open";
}

export const STATUS_LABELS: Record<Tournament["status"], string> = {
  DRAFT: "Rascunho",
  REGISTRATION: "Inscrições abertas",
  CHECK_IN: "Check-in",
  LIVE: "Em andamento",
  COMPLETED: "Encerrado",
  CANCELED: "Cancelado",
};

/** Política de reembolso automático ao desistir: integral antes do check-in. */
export function refundsOnWithdrawal(t: Pick<Tournament, "status" | "checkInOpensAt" | "startsAt">, now = new Date()): boolean {
  if (t.status === "LIVE" || t.status === "COMPLETED" || t.status === "CANCELED") return false;
  if (t.status === "CHECK_IN") return false;
  const limit = t.checkInOpensAt ?? new Date(t.startsAt.getTime() - 24 * 3600_000);
  return now < limit;
}
