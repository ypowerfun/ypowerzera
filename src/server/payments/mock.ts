import { randomToken } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import type { PaymentProvider } from "./types";

/**
 * Provedor de pagamento SIMULADO, só para desenvolvimento e testes.
 * Nenhum dinheiro é movimentado. Em produção é recusado (veja assertProductionConfig).
 */
export const mockProvider: PaymentProvider = {
  name: "mock",
  async createCheckout({ order }) {
    return { redirectUrl: `${getEnv().appUrl}/checkout/${order.id}`, sessionId: `mock_${order.id}` };
  },
  async refund() {
    return { refundId: `mock_re_${randomToken(8)}` };
  },
};
