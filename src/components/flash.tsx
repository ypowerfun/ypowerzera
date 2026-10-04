"use client";

import { useSearchParams } from "next/navigation";
import { Alert } from "./ui";

/** Confirmações pós-ação do painel admin. O parâmetro é um CÓDIGO fixo — texto livre da URL nunca é exibido. */
const MESSAGES: Record<string, string> = {
  kyc: "Cadastro analisado.",
  saque: "Saque analisado.",
  "saque-conciliado": "Saque conciliado.",
  deposito: "Depósito resolvido.",
  desafio: "Disputa decidida.",
  congelada: "Carteira congelada.",
  liberada: "Carteira liberada.",
  ajuste: "Ajuste lançado no razão.",
};

export function Flash() {
  const msg = MESSAGES[useSearchParams().get("ok") ?? ""];
  return msg ? <Alert tone="ok" className="mb-4">{msg}</Alert> : null;
}
