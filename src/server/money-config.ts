/**
 * Limites e janelas de segurança do dinheiro. Todos os valores monetários em centavos.
 * Podem ser ajustados por variável de ambiente, mas os padrões já são conservadores.
 */
function int(name: string, def: number): number {
  const v = process.env[name];
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export function moneyConfig() {
  return {
    depositMinCents: int("DEPOSIT_MIN_CENTS", 1_000), // R$ 10
    depositMaxCents: int("DEPOSIT_MAX_CENTS", 500_000), // R$ 5.000
    depositDailyUserCents: int("DEPOSIT_DAILY_USER_CENTS", 1_000_000), // R$ 10.000/dia por pessoa
    depositMaxPending: int("DEPOSIT_MAX_PENDING", 3),
    depositTtlMinutes: int("DEPOSIT_TTL_MINUTES", 30),

    withdrawMinCents: int("WITHDRAW_MIN_CENTS", 2_000), // R$ 20
    withdrawMaxCents: int("WITHDRAW_MAX_CENTS", 200_000), // R$ 2.000 por pedido
    withdrawDailyTeamCents: int("WITHDRAW_DAILY_TEAM_CENTS", 500_000), // R$ 5.000/dia por equipe
    withdrawDailyCount: int("WITHDRAW_DAILY_COUNT", 3),
    withdrawFeeCents: int("WITHDRAW_FEE_CENTS", 0),
    withdrawAutoApproveMaxCents: int("WITHDRAW_AUTO_APPROVE_MAX_CENTS", 30_000), // R$ 300
    withdrawDelayMinutes: int("WITHDRAW_DELAY_MINUTES", 30),
    withdrawReviewRiskThreshold: int("WITHDRAW_REVIEW_RISK_THRESHOLD", 40),
    otpTtlMinutes: int("OTP_TTL_MINUTES", 10),
    otpMaxAttempts: int("OTP_MAX_ATTEMPTS", 5),
    accountMinAgeHours: int("ACCOUNT_MIN_AGE_HOURS", 24),
    securityLockHours: int("SECURITY_LOCK_HOURS", 24),

    /** Depósitos recentes ficam retidos (janela do MED do Pix e de estornos). */
    depositHoldHours: int("DEPOSIT_HOLD_HOURS", 72),
    /** Prêmios de desafios recentes ficam retidos (janela de contestação). */
    winHoldHours: int("WIN_HOLD_HOURS", 24),

    stakeMinCents: int("STAKE_MIN_CENTS", 100), // R$ 1
    stakeMaxCents: int("STAKE_MAX_CENTS", 50_000), // R$ 500
    challengeFeeBps: int("CHALLENGE_FEE_BPS", 1_000), // 10% do pote
    challengeOpenTtlHours: int("CHALLENGE_OPEN_TTL_HOURS", 24),
    maxOpenChallengesPerTeam: int("MAX_OPEN_CHALLENGES_PER_TEAM", 5),
    autoSettleWindowMinutes: int("AUTO_SETTLE_WINDOW_MINUTES", 60),
    autoSettleMaxStakeCents: int("AUTO_SETTLE_MAX_STAKE_CENTS", 10_000), // R$ 100
    teamMinAgeHours: int("TEAM_MIN_AGE_HOURS", 24),
    repeatedPairThreshold: int("REPEATED_PAIR_THRESHOLD", 3),
  };
}

export const CREDIT_CENTS = 100;
export const isWholeCredits = (cents: number) => Number.isInteger(cents) && cents > 0 && cents % CREDIT_CENTS === 0;
export const creditsToCents = (credits: number) => Math.round(credits * CREDIT_CENTS);
export const centsToCredits = (cents: number) => cents / CREDIT_CENTS;
