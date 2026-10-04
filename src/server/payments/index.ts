import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { mockProvider } from "./mock";
import { stripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

export function getProvider(): PaymentProvider {
  const env = getEnv();
  if (env.paymentsProvider === "stripe") {
    if (!env.stripeSecretKey) throw new AppError("Pagamentos indisponíveis: Stripe não configurado.");
    return stripeProvider;
  }
  if (env.isProd && !env.allowMockPayments) {
    throw new AppError("Pagamentos indisponíveis: configure PAYMENTS_PROVIDER=stripe.");
  }
  return mockProvider;
}

export function paymentsAvailable(): boolean {
  try {
    getProvider();
    return true;
  } catch {
    return false;
  }
}

export type { PaymentProvider } from "./types";
