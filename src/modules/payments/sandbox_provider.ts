import crypto from 'crypto';
import {
  PaymentProvider,
  PaymentAuthorizeRequest,
  PaymentAuthorizeResponse,
  PaymentCaptureRequest,
  PaymentRefundRequest,
  PaymentRefundResponse,
  WebhookEvent,
  WebhookVerificationResult,
} from './types.js';
import { config } from '../../config/index.js';

export class SandboxPaymentProvider implements PaymentProvider {
  public readonly providerName = 'sandbox';
  private webhookSecret: string;

  constructor(webhookSecret?: string) {
    this.webhookSecret = webhookSecret || config.sandboxWebhookSecret;
  }

  async authorize(req: PaymentAuthorizeRequest): Promise<PaymentAuthorizeResponse> {
    const simulate = req.simulateStatus || 'success';
    const cardToken = req.paymentMethodDetails?.testCardToken;

    if (simulate === 'timeout') {
      return {
        success: false,
        providerPaymentId: `pay_sbx_timeout_${Date.now()}`,
        status: 'failed',
        errorCode: 'GATEWAY_TIMEOUT',
        errorMessage: 'Simulated payment gateway timeout',
        rawPayload: { simulateStatus: 'timeout' },
      };
    }

    if (simulate === 'failure' || cardToken === 'tok_card_declined') {
      return {
        success: false,
        providerPaymentId: `pay_sbx_failed_${Date.now()}`,
        status: 'failed',
        errorCode: 'CARD_DECLINED',
        errorMessage: 'Simulated card declined',
        rawPayload: { simulateStatus: 'failure', cardToken },
      };
    }

    if (cardToken === 'tok_insufficient_funds') {
      return {
        success: false,
        providerPaymentId: `pay_sbx_failed_${Date.now()}`,
        status: 'failed',
        errorCode: 'INSUFFICIENT_FUNDS',
        errorMessage: 'Simulated insufficient account funds',
        rawPayload: { simulateStatus: 'failure', cardToken },
      };
    }

    const hashInput = `${req.checkoutId}:${req.idempotencyKey}`;
    const providerPaymentId = `pay_sbx_${crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 24)}`;

    return {
      success: true,
      providerPaymentId,
      status: 'captured', // Sandbox immediate capture
      rawPayload: {
        amount: req.amountMinor,
        currency: req.currency,
        authorizedAt: new Date().toISOString(),
      },
    };
  }

  async capture(req: PaymentCaptureRequest): Promise<PaymentAuthorizeResponse> {
    return {
      success: true,
      providerPaymentId: req.providerPaymentId,
      status: 'captured',
      rawPayload: {
        capturedAt: new Date().toISOString(),
        amount: req.amountMinor,
      },
    };
  }

  async refund(req: PaymentRefundRequest): Promise<PaymentRefundResponse> {
    const simulate = req.simulateStatus || 'success';
    if (simulate === 'failure') {
      return {
        success: false,
        providerRefundId: `ref_sbx_failed_${Date.now()}`,
        status: 'failed',
        errorCode: 'REFUND_DECLINED',
        errorMessage: 'Simulated refund decline',
        rawPayload: { reason: req.reason },
      };
    }

    const hashInput = `${req.orderId}:${req.idempotencyKey}`;
    const providerRefundId = `ref_sbx_${crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 24)}`;

    return {
      success: true,
      providerRefundId,
      status: 'succeeded',
      rawPayload: {
        refundedAt: new Date().toISOString(),
        amount: req.amountMinor,
      },
    };
  }

  verifyWebhookSignature(
    rawBody: string | Buffer,
    headers: Record<string, string | string[] | undefined>
  ): WebhookVerificationResult {
    const sigHeader =
      headers['x-sandbox-signature'] ||
      headers['X-Sandbox-Signature'] ||
      (Array.isArray(headers['x-sandbox-signature']) ? headers['x-sandbox-signature'][0] : undefined);

    if (!sigHeader || typeof sigHeader !== 'string') {
      return { isValid: false, error: 'Missing X-Sandbox-Signature header' };
    }

    // Format: t=<timestamp>,v1=<signature>
    const parts = sigHeader.split(',').reduce((acc, part) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    }, {} as Record<string, string>);

    const timestamp = parts['t'];
    const signature = parts['v1'];

    if (!timestamp || !signature) {
      return { isValid: false, error: 'Malformed signature header format' };
    }

    // Verify timestamp freshness (within 5 minutes)
    const eventTime = parseInt(timestamp, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (isNaN(eventTime) || Math.abs(nowSec - eventTime) > 300) {
      return { isValid: false, error: 'Webhook timestamp expired or out of tolerance window' };
    }

    const bodyString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    const signedPayload = `${timestamp}.${bodyString}`;
    const expectedSig = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(signedPayload)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSig, 'hex');
    const receivedBuf = Buffer.from(signature, 'hex');

    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return { isValid: false, error: 'Invalid HMAC signature' };
    }

    try {
      const parsed = JSON.parse(bodyString);
      return {
        isValid: true,
        event: {
          provider: this.providerName,
          providerEventId: parsed.id || parsed.providerEventId || `evt_${Date.now()}`,
          eventType: parsed.type || parsed.eventType || 'payment.captured',
          checkoutId: parsed.data?.checkoutId || parsed.checkoutId,
          orderId: parsed.data?.orderId || parsed.orderId,
          providerPaymentId: parsed.data?.providerPaymentId || parsed.providerPaymentId,
          amountMinor: parsed.data?.amountMinor || parsed.amountMinor,
          currency: parsed.data?.currency || parsed.currency || 'INR',
          timestamp: new Date(eventTime * 1000).toISOString(),
          rawPayload: parsed,
        },
      };
    } catch (err: any) {
      return { isValid: false, error: `Invalid JSON payload: ${err.message}` };
    }
  }

  generateWebhookPayload(
    event: Partial<WebhookEvent>,
    secret: string = this.webhookSecret
  ): { rawBody: string; headers: Record<string, string> } {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payloadObj = {
      id: event.providerEventId || `evt_sbx_${Date.now()}`,
      type: event.eventType || 'payment.captured',
      checkoutId: event.checkoutId,
      providerPaymentId: event.providerPaymentId,
      amountMinor: event.amountMinor,
      currency: event.currency || 'INR',
      data: event.rawPayload || {
        checkoutId: event.checkoutId,
        orderId: event.orderId,
        providerPaymentId: event.providerPaymentId,
        amountMinor: event.amountMinor,
        currency: event.currency || 'INR',
      },
    };

    const rawBody = JSON.stringify(payloadObj);
    const signedPayload = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    return {
      rawBody,
      headers: {
        'Content-Type': 'application/json',
        'X-Sandbox-Signature': `t=${timestamp},v1=${signature}`,
      },
    };
  }
}
