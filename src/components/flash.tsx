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
  cargo: "Cargo atualizado.",
  "time-excluido": "Time excluído. O saldo, se houver, ficou bloqueado até a revisão.",
  "time-excluido-saldo": "Time excluído. O saldo ficou BLOQUEADO: peça a revisão do administrador na Carteira para liberá-lo para saque.",
  "revisao-pedida": "Pedido enviado. Um administrador vai analisar o saldo e você será avisado por notificação.",
  "saldo-liberado": "Saldo liberado para saque pelo ex-líder.",
  "saldo-recusado": "Pedido de liberação recusado.",
  "carteira-ligada": "Carteira ativada: a aba e os desafios já aparecem para os usuários.",
  "carteira-desligada": "Carteira desativada: a aba some e novos depósitos, saques e desafios ficam bloqueados.",
  "saque-admin-on": "Agora todo saque espera a liberação de um administrador.",
  "saque-admin-off": "Saques pequenos e sem sinais de risco voltaram a ser aprovados automaticamente.",
};

export function Flash() {
  const code = useSearchParams().get("ok") ?? "";
  const msg = Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined; // "__proto__"/"constructor" não são códigos
  return msg ? <Alert tone="ok" className="mb-4">{msg}</Alert> : null;
}
