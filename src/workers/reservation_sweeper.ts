import { withTransaction } from '../db/pool.js';
import { config } from '../config/index.js';

export interface SweepResult {
  sweptCount: number;
  releasedProducts: Array<{ productId: string; quantity: number }>;
}

export class ReservationSweeper {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private batchSize: number;

  constructor(options?: { intervalMs?: number; batchSize?: number }) {
    this.intervalMs = options?.intervalMs || config.sweeperIntervalMs;
    this.batchSize = options?.batchSize || config.sweeperBatchSize;
  }

  /**
   * Perform a single sweep iteration using SELECT ... FOR UPDATE SKIP LOCKED.
   * Can be directly invoked by tests or by background runner.
   */
  async sweepExpiredReservations(limit: number = this.batchSize): Promise<SweepResult> {
    return await withTransaction(async (client) => {
      // 1. Claim expired pending reservations using partial index & SKIP LOCKED
      const res = await client.query<{
        id: string;
        checkout_id: string;
        product_id: string;
        flash_sale_id: string | null;
        quantity: number;
      }>(
        `SELECT id, checkout_id, product_id, flash_sale_id, quantity
         FROM inventory_reservations
         WHERE status = 'pending'
           AND expires_at < clock_timestamp()
         ORDER BY product_id ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit]
      );

      if (res.rows.length === 0) {
        return { sweptCount: 0, releasedProducts: [] };
      }

      const releasedProducts: Array<{ productId: string; quantity: number }> = [];

      for (const row of res.rows) {
        // Lock inventory row in consistent ascending order
        await client.query(
          `SELECT id FROM inventory WHERE product_id = $1 FOR UPDATE`,
          [row.product_id]
        );

        // Replenish regular inventory
        await client.query(
          `UPDATE inventory
           SET reserved_qty = GREATEST(0, reserved_qty - $1),
               updated_at = clock_timestamp()
           WHERE product_id = $2`,
          [row.quantity, row.product_id]
        );

        // Replenish flash sale quota if applicable
        if (row.flash_sale_id) {
          await client.query(
            `UPDATE flash_sales
             SET quantity_reserved = GREATEST(0, quantity_reserved - $1),
                 updated_at = clock_timestamp()
             WHERE id = $2`,
            [row.quantity, row.flash_sale_id]
          );
        }

        // Mark reservation expired
        await client.query(
          `UPDATE inventory_reservations
           SET status = 'expired',
               released_at = clock_timestamp(),
               updated_at = clock_timestamp()
           WHERE id = $1`,
          [row.id]
        );

        // Expire parent checkout if no pending reservations remain
        await client.query(
          `UPDATE checkouts
           SET status = 'expired', updated_at = clock_timestamp()
           WHERE id = $1
             AND status IN ('created', 'pending_payment')
             AND NOT EXISTS (
               SELECT 1 FROM inventory_reservations
               WHERE checkout_id = $1 AND status = 'pending'
             )`,
          [row.checkout_id]
        );

        // Cancel pending orders for this checkout
        await client.query(
          `UPDATE orders
           SET status = 'cancelled', updated_at = clock_timestamp()
           WHERE checkout_id = $1 AND status IN ('created', 'pending_payment')`,
          [row.checkout_id]
        );

        // Record in audit log
        await client.query(
          `INSERT INTO audit_log (action, target_type, target_id, changes)
           VALUES ('reservation.expired_swept', 'inventory_reservation', $1, $2)`,
          [row.id, JSON.stringify({ product_id: row.product_id, quantity_released: row.quantity })]
        );

        releasedProducts.push({ productId: row.product_id, quantity: row.quantity });
      }

      return { sweptCount: res.rows.length, releasedProducts };
    });
  }

  /**
   * Start periodic background loop with jitter.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext(0);
  }

  /**
   * Stop background loop cleanly.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      try {
        let sweptTotal = 0;
        let batchResult: SweepResult;
        // Drain loop: keep sweeping if full batch was retrieved
        do {
          batchResult = await this.sweepExpiredReservations(this.batchSize);
          sweptTotal += batchResult.sweptCount;
        } while (batchResult.sweptCount === this.batchSize && this.isRunning);

        if (sweptTotal > 0 && process.env.NODE_ENV !== 'test') {
          console.log(`[ReservationSweeper] Swept and released ${sweptTotal} expired reservations.`);
        }
      } catch (err: any) {
        if (process.env.NODE_ENV !== 'test') {
          console.error('[ReservationSweeper] Error sweeping expired reservations:', err.message);
        }
      } finally {
        // Apply ±10% jitter to prevent thundering herd
        const jitter = (Math.random() - 0.5) * 0.2 * this.intervalMs;
        const nextInterval = Math.max(1000, this.intervalMs + jitter);
        this.scheduleNext(nextInterval);
      }
    }, delayMs);
  }
}
