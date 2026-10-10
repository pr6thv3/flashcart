import { Request, Response } from 'express';
import { query } from '../../db/pool.js';
import { SandboxPaymentProvider } from './sandbox_provider.js';
import { PaymentService } from './payment_service.js';
import { AuthenticatedRequest } from '../../common/types.js';

const sandboxProvider = new SandboxPaymentProvider();
const paymentService = new PaymentService(sandboxProvider);

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const authReq = req as AuthenticatedRequest;
  const requestId = authReq.id || authReq.requestId || 'unknown-req-id';
  const provider = req.params.provider;

  if (provider !== 'sandbox') {
    res.status(400).json({
      error: {
        code: 'UNSUPPORTED_PROVIDER',
        message: `Provider ${provider} is not supported`,
        requestId,
      },
    });
    return;
  }

  // 1. Raw body verification
  const rawBody = (req as any).rawBody || req.body;
  const verification = sandboxProvider.verifyWebhookSignature(rawBody, req.headers as any);

  if (!verification.isValid || !verification.event) {
    res.status(401).json({
      error: {
        code: 'INVALID_SIGNATURE',
        message: verification.error || 'Webhook signature verification failed',
        requestId,
      },
    });
    return;
  }

  const event = verification.event;

  try {
    // 2. IDEMPOTENT INGESTION: INSERT ON CONFLICT DO NOTHING
    const insertRes = await query<{ id: string; status: string }>(
      `INSERT INTO payment_webhook_events (
         provider, provider_event_id, event_type, payload, status
       ) VALUES ($1, $2, $3, $4, 'received')
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id, status`,
      [event.provider, event.providerEventId, event.eventType, JSON.stringify(event.rawPayload)]
    );

    if (insertRes.rows.length === 0) {
      // DUPLICATE WEBHOOK: Already received or processed!
      res.status(200).json({
        status: 'already_processed',
        provider_event_id: event.providerEventId,
        message: 'Duplicate webhook acknowledged safely',
      });
      return;
    }

    const webhookEventId = insertRes.rows[0].id;

    // 3. Process event type
    if (event.eventType === 'payment.captured' && event.checkoutId) {
      // Find latest initiated payment attempt
      const attemptRes = await query<{ id: string }>(
        `SELECT id FROM payment_attempts WHERE checkout_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [event.checkoutId]
      );
      const attemptId = attemptRes.rows[0]?.id || '00000000-0000-0000-0000-000000000000';

      await paymentService.finalizePaymentSuccess(
        event.checkoutId,
        attemptId,
        event.providerPaymentId || event.providerEventId
      );

      await query(
        `UPDATE payment_webhook_events
         SET status = 'processed', processed_at = clock_timestamp()
         WHERE id = $1`,
        [webhookEventId]
      );
    } else if (event.eventType === 'payment.failed' && event.checkoutId) {
      const attemptRes = await query<{ id: string }>(
        `SELECT id FROM payment_attempts WHERE checkout_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [event.checkoutId]
      );
      const attemptId = attemptRes.rows[0]?.id || '00000000-0000-0000-0000-000000000000';

      await paymentService.finalizePaymentFailure(
        event.checkoutId,
        attemptId,
        'WEBHOOK_REPORTED_FAILURE',
        'Payment failed according to provider webhook notification'
      );

      await query(
        `UPDATE payment_webhook_events
         SET status = 'processed', processed_at = clock_timestamp()
         WHERE id = $1`,
        [webhookEventId]
      );
    } else {
      await query(
        `UPDATE payment_webhook_events
         SET status = 'ignored', processed_at = clock_timestamp()
         WHERE id = $1`,
        [webhookEventId]
      );
    }

    res.status(200).json({
      status: 'success',
      provider_event_id: event.providerEventId,
    });
  } catch (err: any) {
    await query(
      `UPDATE payment_webhook_events
       SET status = 'failed', error_message = $1
       WHERE provider = $2 AND provider_event_id = $3`,
      [err.message, event.provider, event.providerEventId]
    ).catch(() => {});

    res.status(500).json({
      error: {
        code: 'WEBHOOK_PROCESSING_ERROR',
        message: err.message,
        requestId,
      },
    });
  }
}
