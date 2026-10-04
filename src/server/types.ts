import type { Role } from "@prisma/client";

/** Usuário autenticado, como entregue pelos serviços. */
export interface Actor {
  id: string;
  role: Role;
  email?: string;
  emailVerifiedAt?: Date | null;
  displayName?: string;
}

export interface RosterMember {
  userId: string;
  displayName: string;
  handle: string;
  role: "starter" | "sub";
  /** Campos da conta de jogo (Riot ID, plataforma...). */
  identity: Record<string, string>;
}

export interface CustomField {
  key: string;
  label: string;
  type: "text" | "select" | "checkbox";
  required: boolean;
  /** Visível só para a organização. */
  private: boolean;
  options?: string[];
}

export interface PrizeSplitEntry {
  placement: number;
  label: string;
  /** Percentual do prêmio total (0–100). */
  percent: number;
}
