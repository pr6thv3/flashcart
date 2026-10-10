import { describe, it, expect } from 'vitest';
import { SandboxPaymentProvider } from '../../src/modules/payments/sandbox_provider.js';

describe('Sandbox Payment Provider Unit Tests', () => {
  const secret = 'test_webhook_secret_key_999';
  const provider = new SandboxPaymentProvider(secret);

  it('authorizes successfully and returns captured status', async () => {
    const res = await provider.authorize({
      checkoutId: '00000000-0000-0000-0000-000000000001',
      amountMinor: 2500,
      currency: 'INR',
      idempotencyKey: 'idemp_test_1',
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('captured');
    expect(res.providerPaymentId).toMatch(/^pay_sbx_/);
  });

  it('handles simulated card declined failure', async () => {
    const res = await provider.authorize({
      checkoutId: '00000000-0000-0000-0000-000000000001',
      amountMinor: 2500,
      currency: 'INR',
      idempotencyKey: 'idemp_test_2',
      simulateStatus: 'failure',
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('CARD_DECLINED');
  });

  it('handles card token tok_card_declined failure', async () => {
    const res = await provider.authorize({
      checkoutId: '00000000-0000-0000-0000-000000000001',
      amountMinor: 2500,
      currency: 'INR',
      idempotencyKey: 'idemp_test_3',
      paymentMethodDetails: {
        type: 'card',
        testCardToken: 'tok_card_declined',
      },
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('failed');
    expect(res.errorCode).toBe('CARD_DECLINED');
  });

  it('handles simulated timeout', async () => {
    const res = await provider.authorize({
      checkoutId: '00000000-0000-0000-0000-000000000001',
      amountMinor: 2500,
      currency: 'INR',
      idempotencyKey: 'idemp_test_4',
      simulateStatus: 'timeout',
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('GATEWAY_TIMEOUT');
  });

  it('generates and verifies HMAC-SHA256 signed webhook payload', () => {
    const payload = provider.generateWebhookPayload({
      providerEventId: 'evt_12345',
      eventType: 'payment.captured',
      checkoutId: '00000000-0000-0000-0000-000000000001',
      amountMinor: 2500,
      currency: 'INR',
    });

    const verification = provider.verifyWebhookSignature(payload.rawBody, payload.headers);

    expect(verification.isValid).toBe(true);
    expect(verification.event).toBeDefined();
    expect(verification.event?.providerEventId).toBe('evt_12345');
    expect(verification.event?.eventType).toBe('payment.captured');
    expect(verification.event?.checkoutId).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('rejects tampered webhook payload', () => {
    const payload = provider.generateWebhookPayload({
      providerEventId: 'evt_tamper_test',
      eventType: 'payment.captured',
      amountMinor: 2500,
    });

    // Tamper with the raw body
    const tamperedBody = payload.rawBody.replace('2500', '9999');

    const verification = provider.verifyWebhookSignature(tamperedBody, payload.headers);

    expect(verification.isValid).toBe(false);
    expect(verification.error).toBe('Invalid HMAC signature');
  });

  it('rejects expired webhook timestamp (older than 300s)', () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
    const rawBody = JSON.stringify({ id: 'evt_old' });
    const signature = 'dummy_sig';

    const verification = provider.verifyWebhookSignature(rawBody, {
      'x-sandbox-signature': `t=${oldTimestamp},v1=${signature}`,
    });

    expect(verification.isValid).toBe(false);
    expect(verification.error).toContain('tolerance window');
  });
});
