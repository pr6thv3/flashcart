import { query, withTransaction } from '../../db/pool.js';
import { SandboxPaymentProvider } from './sandbox_provider.js';
import { PaymentProvider, PaymentAuthorizeRequest } from './types.js';
import { AppError, NotFoundError } from '../../common/errors.js';

export class PaymentService {
  private provider: PaymentProvider;

  constructor(provider?: PaymentProvider) {
    this.provider = provider || new SandboxPaymentProvider();
  }

  /**
   * Process payment for an existing reservation.
   * STRICT DECOUPLING: External payment interaction runs OUTSIDE any DB transaction!
   */
  async processPayment(params: {
    customerId: string;
    checkoutId: string;
    idempotencyKey?: string;
    paymentMethod?: string;
    simulateStatus?: 'success' | 'failure' | 'timeout';
    testCardToken?: string;
  }) {
    const idempKey = params.idempotencyKey || `pay_idemp_${params.checkoutId}_${Date.now()}`;

    // 1. Read checkout & verify state (read-only query)
    const chkRes = await query<{
      id: string;
      customer_id: string;
      status: string;
      total_minor: number;
      currency: string;
      expires_at: Date;
    }>(
      `SELECT id, customer_id, status, total_minor, currency, expires_at
       FROM checkouts
       WHERE id = $1
          OR id = (SELECT checkout_id FROM inventory_reservations WHERE id = $1 LIMIT 1)`,
      [params.checkoutId]
    );

    if (chkRes.rows.length === 0) {
      throw new NotFoundError('Checkout not found');
    }
    const checkout = chkRes.rows[0];

    if (checkout.customer_id !== params.customerId) {
      throw new NotFoundError('Checkout not found');
    }

    if (checkout.status === 'paid') {
      const orders = await query(
        `SELECT id as "orderId", order_number as "orderNumber", vendor_id as "vendorId",
                status, total_minor as "totalMinor"
         FROM orders WHERE checkout_id = $1`,
        [checkout.id]
      );
      return {
        checkoutId: checkout.id,
        status: 'paid',
        orders: orders.rows,
        isAlreadyPaid: true,
      };
    }

    if (checkout.status === 'failed' || checkout.status === 'cancelled') {
      throw new AppError(409, 'INVALID_STATE', `Checkout is already ${checkout.status}`);
    }

    // 2. Insert or get payment_attempt in 'initiated' state
    const attemptRes = await query<{ id: string; status: string }>(
      `INSERT INTO payment_attempts (
         checkout_id, provider, idempotency_key, amount_minor, currency, status
       ) VALUES ($1, $2, $3, $4, $5, 'initiated')
       ON CONFLICT (checkout_id, idempotency_key) DO UPDATE
         SET updated_at = clock_timestamp()
       RETURNING id, status`,
      [checkout.id, this.provider.providerName, idempKey, checkout.total_minor, checkout.currency]
    );
    const paymentAttempt = attemptRes.rows[0];

    // 3. EXTERNAL GATEWAY CALL (ZERO DB LOCKS HELD!)
    const authReq: PaymentAuthorizeRequest = {
      checkoutId: checkout.id,
      amountMinor: Number(checkout.total_minor),
      currency: checkout.currency,
      idempotencyKey: idempKey,
      simulateStatus: params.simulateStatus || 'success',
      paymentMethodDetails: {
        type: 'sandbox',
        testCardToken: params.testCardToken,
      },
    };

    const authResult = await this.provider.authorize(authReq);

    // 4. TRANSITION PHASE (SHORT DB TRANSACTION)
    if (authResult.success && authResult.status === 'captured') {
      return await this.finalizePaymentSuccess(checkout.id, paymentAttempt.id, authResult.providerPaymentId);
    } else {
      return await this.finalizePaymentFailure(
        checkout.id,
        paymentAttempt.id,
        authResult.errorCode || 'PAYMENT_FAILED',
        authResult.errorMessage || 'Payment authorization declined'
      );
    }
  }

  /**
   * Shorthand helper for testing or direct sandbox simulation.
   */
  async processSandboxPayment(
    customerId: string,
    checkoutId: string,
    idempotencyKey: string,
    simulateStatus: 'success' | 'failure' = 'success'
  ) {
    return await this.processPayment({
      customerId,
      checkoutId,
      idempotencyKey,
      simulateStatus,
    });
  }

  /**
   * Finalize payment success (Phase C).
   */
  async finalizePaymentSuccess(checkoutId: string, paymentAttemptId: string, providerPaymentId: string) {
    return await withTransaction(async (client) => {
      // 1. Lock checkout row
      const chk = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM checkouts WHERE id = $1 FOR UPDATE`,
        [checkoutId]
      );
      if (chk.rows.length === 0) {
        throw new NotFoundError('Checkout not found');
      }
      if (chk.rows[0].status === 'paid') {
        const orders = await client.query(
          `SELECT id as "orderId", order_number as "orderNumber", vendor_id as "vendorId",
                  status, total_minor as "totalMinor"
           FROM orders WHERE checkout_id = $1`,
          [checkoutId]
        );
        return { checkoutId, status: 'paid', orders: orders.rows, isAlreadyPaid: true };
      }

      // 2. Lock reservations for checkout in deterministic order
      const resRows = await client.query<{
        id: string;
        product_id: string;
        flash_sale_id: string | null;
        quantity: number;
        status: string;
        expires_at: Date;
      }>(
        `SELECT id, product_id, flash_sale_id, quantity, status, expires_at
         FROM inventory_reservations
         WHERE checkout_id = $1
         ORDER BY product_id ASC, id ASC
         FOR UPDATE`,
        [checkoutId]
      );

      const hasExpired =
        chk.rows[0].status === 'expired' ||
        resRows.rows.length === 0 ||
        resRows.rows.some((r) => r.status === 'expired' || new Date(r.expires_at) < new Date());

      // LATE PAYMENT RACE: Sweeper already expired reservation!
      if (hasExpired) {
        // DO NOT OVERSELL! Initiate compensating refund!
        await client.query(
          `UPDATE payment_attempts
           SET status = 'failed', error_code = 'RESERVATION_EXPIRED_REFUND_REQUIRED',
               error_message = 'Payment captured after reservation expired; automated refund queued.',
               updated_at = clock_timestamp()
           WHERE id = $1`,
          [paymentAttemptId]
        );
        await client.query(
          `UPDATE checkouts SET status = 'expired', updated_at = clock_timestamp() WHERE id = $1`,
          [checkoutId]
        );
        await client.query(
          `UPDATE orders SET status = 'cancelled', updated_at = clock_timestamp() WHERE checkout_id = $1`,
          [checkoutId]
        );
        await client.query(
          `INSERT INTO outbox_jobs (job_type, payload)
           VALUES ('payment.refund_required', $1)`,
          [JSON.stringify({
            checkout_id: checkoutId,
            payment_attempt_id: paymentAttemptId,
            reason: 'LATE_PAYMENT_EXPIRED_RESERVATION',
          })]
        );
        await client.query(
          `INSERT INTO audit_log (action, target_type, target_id, changes)
           VALUES ('payment.late_expired_reconciled', 'checkout', $1, '{"status":"expired"}'::jsonb)`,
          [checkoutId]
        );
        return { status: 'expired_refund_queued', checkoutId };
      }

      // Normal flow: Consume reservation and deduct inventory
      for (const res of resRows.rows) {
        // Lock inventory row in sorted order
        await client.query(
          `SELECT id FROM inventory WHERE product_id = $1 FOR UPDATE`,
          [res.product_id]
        );

        // Atomic inventory physical deduction
        await client.query(
          `UPDATE inventory
           SET reserved_qty = reserved_qty - $1,
               on_hand_qty = on_hand_qty - $1,
               version = version + 1,
               updated_at = clock_timestamp()
           WHERE product_id = $2`,
          [res.quantity, res.product_id]
        );

        // Flash sale counter updates
        if (res.flash_sale_id) {
          await client.query(
            `UPDATE flash_sales
             SET quantity_reserved = quantity_reserved - $1,
                 quantity_sold = quantity_sold + $1,
                 updated_at = clock_timestamp()
             WHERE id = $2`,
            [res.quantity, res.flash_sale_id]
          );
        }

        // Mark reservation consumed
        await client.query(
          `UPDATE inventory_reservations
           SET status = 'consumed', consumed_at = clock_timestamp(), updated_at = clock_timestamp()
           WHERE id = $1`,
          [res.id]
        );
      }

      // Update payment_attempts
      await client.query(
        `UPDATE payment_attempts
         SET status = 'captured', provider_payment_id = $1, updated_at = clock_timestamp()
         WHERE id = $2`,
        [providerPaymentId, paymentAttemptId]
      );

      // Update checkouts to paid
      await client.query(
        `UPDATE checkouts SET status = 'paid', updated_at = clock_timestamp() WHERE id = $1`,
        [checkoutId]
      );

      // Update orders to paid
      const ordersRes = await client.query<{ id: string; vendor_id: string; total_minor: string; order_number: string }>(
        `UPDATE orders SET status = 'paid', updated_at = clock_timestamp()
         WHERE checkout_id = $1
         RETURNING id, vendor_id, total_minor, order_number`,
        [checkoutId]
      );

      // Record order status history
      for (const ord of ordersRes.rows) {
        await client.query(
          `INSERT INTO order_status_history (
             order_id, old_status, new_status, actor_type, reason
           ) VALUES ($1, 'created', 'paid', 'system', 'Payment successfully captured')`,
          [ord.id]
        );
      }

      // Transactional Outbox Job: zero event loss
      await client.query(
        `INSERT INTO outbox_jobs (job_type, payload)
         VALUES ('order.paid', $1)`,
        [JSON.stringify({ checkout_id: checkoutId })]
      );

      // Audit Log
      await client.query(
        `INSERT INTO audit_log (action, target_type, target_id, changes)
         VALUES ('payment.captured', 'checkout', $1, $2)`,
        [checkoutId, JSON.stringify({ provider_payment_id: providerPaymentId })]
      );

      const orders = ordersRes.rows.map((o) => ({
        orderId: o.id,
        orderNumber: o.order_number,
        vendorId: o.vendor_id,
        status: 'paid',
        totalMinor: Number(o.total_minor),
        totalCents: Number(o.total_minor),
      }));

      return {
        checkoutId,
        checkout_id: checkoutId,
        status: 'paid',
        providerPaymentId,
        orders,
      };
    });
  }

  /**
   * Finalize payment failure (Phase D).
   */
  async finalizePaymentFailure(
    checkoutId: string,
    paymentAttemptId: string,
    errorCode: string,
    errorMessage: string
  ) {
    return await withTransaction(async (client) => {
      // Release pending reservations
      const resRows = await client.query<{
        id: string;
        product_id: string;
        flash_sale_id: string | null;
        quantity: number;
        status: string;
      }>(
        `SELECT id, product_id, flash_sale_id, quantity, status
         FROM inventory_reservations
         WHERE checkout_id = $1 AND status = 'pending'
         ORDER BY product_id ASC, id ASC
         FOR UPDATE`,
        [checkoutId]
      );

      for (const res of resRows.rows) {
        await client.query(
          `UPDATE inventory
           SET reserved_qty = GREATEST(0, reserved_qty - $1),
               updated_at = clock_timestamp()
           WHERE product_id = $2`,
          [res.quantity, res.product_id]
        );

        if (res.flash_sale_id) {
          await client.query(
            `UPDATE flash_sales
             SET quantity_reserved = GREATEST(0, quantity_reserved - $1),
                 updated_at = clock_timestamp()
             WHERE id = $2`,
            [res.quantity, res.flash_sale_id]
          );
        }

        await client.query(
          `UPDATE inventory_reservations
           SET status = 'released', released_at = clock_timestamp(), updated_at = clock_timestamp()
           WHERE id = $1`,
          [res.id]
        );
      }

      await client.query(
        `UPDATE payment_attempts
         SET status = 'failed', error_code = $1, error_message = $2, updated_at = clock_timestamp()
         WHERE id = $3`,
        [errorCode, errorMessage, paymentAttemptId]
      );

      await client.query(
        `UPDATE checkouts SET status = 'failed', updated_at = clock_timestamp() WHERE id = $1`,
        [checkoutId]
      );

      await client.query(
        `UPDATE orders SET status = 'cancelled', updated_at = clock_timestamp() WHERE checkout_id = $1`,
        [checkoutId]
      );

      await client.query(
        `INSERT INTO audit_log (action, target_type, target_id, changes)
         VALUES ('payment.failed', 'checkout', $1, $2)`,
        [checkoutId, JSON.stringify({ error_code: errorCode, error_message: errorMessage })]
      );

      return {
        checkoutId,
        checkout_id: checkoutId,
        status: 'failed',
        errorCode,
        errorMessage,
      };
    });
  }
}
