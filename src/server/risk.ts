import { moneyConfig } from "./money-config";

export type RiskFlag =
  | "FIRST_WITHDRAWAL"
  | "LARGE_AMOUNT"
  | "NEW_ACCOUNT"
  | "KYC_RECENT"
  | "RECENT_SECURITY_CHANGE"
  | "UNVERIFIED_PAYER_DEPOSITS"
  | "REPEATED_OPPONENT"
  | "SHARED_IP_WIN"
  | "WITHDRAWAL_BURST"
  | "WALLET_FROZEN";

export interface RiskContext {
  amountCents: number;
  firstWithdrawal: boolean;
  accountAgeDays: number;
  kycAgeHours: number;
  recentSecurityChange: boolean;
  unverifiedPayerDeposits: number;
  repeatedOpponentWins: number;
  sharedIpWins: number;
  withdrawalsLast24h: number;
  walletFrozen: boolean;
}

export interface RiskAssessment {
  score: number;
  flags: RiskFlag[];
  needsReview: boolean;
}

const WEIGHTS: Record<RiskFlag, number> = {
  FIRST_WITHDRAWAL: 40,
  LARGE_AMOUNT: 40,
  NEW_ACCOUNT: 30,
  KYC_RECENT: 20,
  RECENT_SECURITY_CHANGE: 60,
  UNVERIFIED_PAYER_DEPOSITS: 40,
  REPEATED_OPPONENT: 40,
  SHARED_IP_WIN: 50,
  WITHDRAWAL_BURST: 30,
  WALLET_FROZEN: 100,
};

/**
 * Pontuação de risco determinística. Qualquer sinal forte (≥ limite) ou a soma de sinais fracos
 * manda o saque para REVISÃO MANUAL; só saques "limpos" e pequenos seguem automaticamente
 * (ainda assim com atraso e janela de cancelamento).
 */
export function assessWithdrawalRisk(ctx: RiskContext): RiskAssessment {
  const cfg = moneyConfig();
  const flags: RiskFlag[] = [];
  if (ctx.firstWithdrawal) flags.push("FIRST_WITHDRAWAL");
  if (ctx.amountCents > cfg.withdrawAutoApproveMaxCents) flags.push("LARGE_AMOUNT");
  if (ctx.accountAgeDays < 7) flags.push("NEW_ACCOUNT");
  if (ctx.kycAgeHours < 24) flags.push("KYC_RECENT");
  if (ctx.recentSecurityChange) flags.push("RECENT_SECURITY_CHANGE");
  if (ctx.unverifiedPayerDeposits > 0) flags.push("UNVERIFIED_PAYER_DEPOSITS");
  if (ctx.repeatedOpponentWins >= cfg.repeatedPairThreshold) flags.push("REPEATED_OPPONENT");
  if (ctx.sharedIpWins > 0) flags.push("SHARED_IP_WIN");
  if (ctx.withdrawalsLast24h >= 2) flags.push("WITHDRAWAL_BURST");
  if (ctx.walletFrozen) flags.push("WALLET_FROZEN");
  const score = flags.reduce((s, f) => s + WEIGHTS[f], 0);
  return { score, flags, needsReview: score >= cfg.withdrawReviewRiskThreshold };
}

export const RISK_LABELS: Record<RiskFlag, string> = {
  FIRST_WITHDRAWAL: "Primeiro saque",
  LARGE_AMOUNT: "Valor acima do limite automático",
  NEW_ACCOUNT: "Conta com menos de 7 dias",
  KYC_RECENT: "Identidade verificada há menos de 24h",
  RECENT_SECURITY_CHANGE: "Senha/segurança alterada recentemente",
  UNVERIFIED_PAYER_DEPOSITS: "Depósitos cujo pagador não pôde ser verificado",
  REPEATED_OPPONENT: "Vitórias repetidas contra o mesmo adversário",
  SHARED_IP_WIN: "Prêmio ganho contra adversário no mesmo IP",
  WITHDRAWAL_BURST: "Vários saques em 24h",
  WALLET_FROZEN: "Carteira congelada",
};
