export interface PaymentAuthorizeRequest {
  checkoutId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  simulateStatus?: 'success' | 'failure' | 'timeout';
  paymentMethodDetails?: {
    type: string;
    testCardToken?: string;
  };
}

export interface PaymentAuthorizeResponse {
  success: boolean;
  providerPaymentId: string;
  status: 'authorized' | 'captured' | 'failed';
  errorCode?: string;
  errorMessage?: string;
  rawPayload: Record<string, any>;
}

export interface PaymentCaptureRequest {
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}

export interface PaymentRefundRequest {
  orderId: string;
  paymentAttemptId: string;
  providerPaymentId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  reason?: string;
  simulateStatus?: 'success' | 'failure';
}

export interface PaymentRefundResponse {
  success: boolean;
  providerRefundId: string;
  status: 'succeeded' | 'failed';
  errorCode?: string;
  errorMessage?: string;
  rawPayload: Record<string, any>;
}

export interface WebhookEvent {
  provider: string;
  providerEventId: string;
  eventType: 'payment.captured' | 'payment.failed' | 'refund.succeeded' | 'refund.failed';
  checkoutId?: string;
  orderId?: string;
  providerPaymentId?: string;
  amountMinor?: number;
  currency?: string;
  timestamp: string;
  rawPayload: Record<string, any>;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  event?: WebhookEvent;
  error?: string;
}

export interface PaymentProvider {
  readonly providerName: string;
  authorize(req: PaymentAuthorizeRequest): Promise<PaymentAuthorizeResponse>;
  capture(req: PaymentCaptureRequest): Promise<PaymentAuthorizeResponse>;
  refund(req: PaymentRefundRequest): Promise<PaymentRefundResponse>;
  verifyWebhookSignature(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): WebhookVerificationResult;
  generateWebhookPayload(
    event: Partial<WebhookEvent>,
    secret?: string
  ): { rawBody: string; headers: Record<string, string> };
}
