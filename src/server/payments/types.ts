import type { Order, Tournament } from "@prisma/client";

export interface CheckoutContext {
  order: Order;
  tournament: Pick<Tournament, "id" | "name" | "slug" | "currency">;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PaymentProvider {
  name: "mock" | "stripe";
  createCheckout(ctx: CheckoutContext): Promise<{ redirectUrl: string; sessionId?: string }>;
  refund(order: Order, amountCents: number, reason: string): Promise<{ refundId: string }>;
}
