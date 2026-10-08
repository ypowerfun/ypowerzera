export type PixEventType = "CHARGE_PAID" | "CHARGE_REVERSED" | "CHARGE_EXPIRED" | "TRANSFER_DONE" | "TRANSFER_FAILED" | "IGNORED";

export interface PixEvent {
  /** Identificador único do evento no provedor (usado para idempotência). */
  id: string;
  type: PixEventType;
  chargeId?: string;
  /** Estorno que o provedor só identifica pelo pagamento (Stripe): a cobrança é achada consultando o provedor. */
  paymentIntentId?: string;
  transferId?: string;
  externalReference?: string;
}

export interface ChargeInfo {
  status: "PENDING" | "PAID" | "REVERSED" | "EXPIRED" | "CANCELED";
  amountCents: number;
  /** CPF/CNPJ de quem pagou (só dígitos), quando o provedor informa. */
  payerDocument: string | null;
  /** Moeda da cobrança (ISO 4217, maiúsculas), quando o provedor informa. Diferente de BRL, o depósito fica retido. */
  currency?: string;
}

export interface TransferInfo {
  status: "PENDING" | "DONE" | "FAILED";
  endToEndId?: string | null;
  failureReason?: string | null;
}

export interface TransferAuthRequest {
  transferId?: string | null;
  externalReference?: string | null;
  amountCents: number;
  /** Chave Pix de destino (CPF, só dígitos) quando informada. */
  pixKey?: string | null;
}

export interface CreateChargeArgs {
  externalReference: string;
  amountCents: number;
  expiresAt: Date;
  payer: { name: string; cpf: string };
}

export interface PixProvider {
  name: "mock" | "asaas" | "stripe";
  /** Consegue pagar Pix a terceiros (saque automático)? Sem isso (Stripe) o saque é pago à mão pelo administrador. */
  canSendPix: boolean;
  createCharge(args: CreateChargeArgs): Promise<{ chargeId: string; copyPaste: string; qrImage?: string | null }>;
  /** Consulta o estado REAL da cobrança no provedor — a fonte da verdade (nunca o corpo do webhook). */
  getCharge(chargeId: string): Promise<ChargeInfo>;
  verifyWebhook(headers: Headers, rawBody: string): boolean;
  parseWebhook(rawBody: string): PixEvent[];
  sendPix(args: { externalReference: string; amountCents: number; pixKey: string; description: string }): Promise<{ transferId: string; status: TransferInfo["status"]; endToEndId?: string | null }>;
  getTransfer(transferId: string): Promise<TransferInfo>;
  verifyTransferAuthorization(headers: Headers, rawBody: string): boolean;
  parseTransferAuthorization(rawBody: string): TransferAuthRequest;
  /** Corpo de resposta no formato que o provedor espera para autorizar/recusar uma transferência. */
  formatTransferAuthResponse(result: { approved: boolean; reason?: string }): unknown;
}
