/** Utilidades de dinheiro. Todos os valores são inteiros em centavos. */

export function formatMoney(cents: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(cents / 100);
}

/** "12,50" | "12.50" | "R$ 12,50" → 1250. Retorna null se inválido. */
export function parseMoneyToCents(input: string): number | null {
  const cleaned = input.replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export interface PriceBreakdown {
  subtotalCents: number;
  discountCents: number;
  serviceFeeCents: number;
  totalCents: number;
}

export interface CouponLike {
  percentOff?: number | null;
  amountOffCents?: number | null;
}

/**
 * Calcula o valor a cobrar: inscrição − cupom, mais a taxa de serviço (sobre o valor já com desconto),
 * paga pelo jogador por cima do valor do organizador.
 */
export function priceOrder(entryFeeCents: number, feeBps: number, coupon?: CouponLike | null): PriceBreakdown {
  const subtotal = Math.max(0, Math.trunc(entryFeeCents));
  let discount = 0;
  if (coupon?.percentOff) discount = Math.floor((subtotal * Math.min(100, coupon.percentOff)) / 100);
  else if (coupon?.amountOffCents) discount = Math.min(subtotal, coupon.amountOffCents);
  const afterDiscount = subtotal - discount;
  const fee = afterDiscount === 0 ? 0 : Math.round((afterDiscount * feeBps) / 10000);
  return { subtotalCents: subtotal, discountCents: discount, serviceFeeCents: fee, totalCents: afterDiscount + fee };
}
