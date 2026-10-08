import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { asaasPix } from "./asaas";
import { mockPix } from "./mock";
import { stripePix } from "./stripe";
import type { PixProvider } from "./types";

export function getPixProvider(): PixProvider {
  const env = getEnv();
  if (env.pixProvider === "asaas") {
    if (!env.asaasApiKey) throw new AppError("Provedor Pix indisponível: Asaas não configurado.");
    return asaasPix;
  }
  if (env.pixProvider === "stripe") {
    if (!env.stripeSecretKey || !env.stripeWebhookSecret) throw new AppError("Provedor Pix indisponível: Stripe não configurado.");
    return stripePix;
  }
  if (env.isProd && !env.allowMockPix) throw new AppError("Provedor Pix indisponível: configure PIX_PROVIDER=asaas ou stripe.");
  return mockPix;
}

export function pixAvailable(): boolean {
  try {
    getPixProvider();
    return true;
  } catch {
    return false;
  }
}

export * from "./types";
