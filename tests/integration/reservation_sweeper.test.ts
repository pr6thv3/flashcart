import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { query } from '../../src/db/pool.js';
import { ReservationSweeper } from '../../src/workers/reservation_sweeper.js';
import { PaymentService } from '../../src/modules/payments/payment_service.js';
import bcrypt from 'bcryptjs';

describe('Reservation Expiry Sweeper & Concurrency Integration Tests', () => {
  const sweeper = new ReservationSweeper();
  const paymentService = new PaymentService();

  let customerId: string;
  let customerToken: string;
  let vendorId: string;
  let productId: string;
  let flashSaleId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Ensure roles
    await query(`
      INSERT INTO roles (name, description) VALUES
        ('customer', 'Customer'), ('vendor', 'Vendor'), ('admin', 'Admin')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Customer
    const cRes = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Sweeper Customer') RETURNING id`,
      [`sweep_cust_${Date.now()}@example.com`, passwordHash]
    );
    customerId = cRes.rows[0].id;
    await query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'customer'`,
      [customerId]
    );
    const cLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [customerId])).rows[0].email, password: 'Password123!' });
    customerToken = cLogin.body.token;

    // Vendor
    const vUser = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Sweeper Vendor') RETURNING id`,
      [`sweep_vend_${Date.now()}@example.com`, passwordHash]
    );
    const vProf = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Sweeper Store', $2, 'approved') RETURNING id`,
      [vUser.rows[0].id, `sweep-store-${Date.now()}`]
    );
    vendorId = vProf.rows[0].id;

    // Product with 10 on_hand_qty
    const pRes = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, 'Sweeper Widget', $2, $3, 'Desc', 1500, 'published') RETURNING id`,
      [vendorId, `sweep-prod-${Date.now()}`, `SWEEP-SKU-${Date.now()}`]
    );
    productId = pRes.rows[0].id;
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 10, 0)`, [productId]);

    // Flash sale with 10 units
    const fsRes = await query<{ id: string }>(
      `INSERT INTO flash_sales (
         product_id, vendor_id, title, sale_price_minor, quantity_limit,
         quantity_reserved, quantity_sold, starts_at, ends_at, is_active
       ) VALUES ($1, $2, 'Sweeper Flash Sale', 999, 10, 0, 0,
                 clock_timestamp() - INTERVAL '10m', clock_timestamp() + INTERVAL '2h', true)
       RETURNING id`,
      [productId, vendorId]
    );
    flashSaleId = fsRes.rows[0].id;
  });

  it('sweeper automatically releases expired pending reservations and restores available stock', async () => {
    // 1. Reserve 3 units
    const resRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `idemp_sweep_exp_${Date.now()}`)
      .send({
        items: [{ productId, flashSaleId, quantity: 3 }],
      });
    expect(resRes.status).toBe(201);
    const checkoutId = resRes.body.checkoutId;

    // Assert initial reserved state
    const fsBefore = await query(`SELECT quantity_reserved FROM flash_sales WHERE id = $1`, [flashSaleId]);
    expect(fsBefore.rows[0].quantity_reserved).toBe(3);
    const invBefore = await query(`SELECT reserved_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(invBefore.rows[0].reserved_qty).toBe(3);

    // 2. Artificially expire the reservations and checkout in DB
    await query(
      `UPDATE inventory_reservations
       SET expires_at = clock_timestamp() - INTERVAL '5 minutes'
       WHERE checkout_id = $1`,
      [checkoutId]
    );
    await query(
      `UPDATE checkouts
       SET expires_at = clock_timestamp() - INTERVAL '5 minutes'
       WHERE id = $1`,
      [checkoutId]
    );

    // 3. Trigger sweeper manually
    const sweepResult = await sweeper.sweepExpiredReservations(100);
    expect(sweepResult.sweptCount).toBeGreaterThanOrEqual(1);

    // 4. Assert stock was replenished
    const fsAfter = await query(`SELECT quantity_reserved, quantity_sold FROM flash_sales WHERE id = $1`, [flashSaleId]);
    expect(fsAfter.rows[0].quantity_reserved).toBe(0);
    expect(fsAfter.rows[0].quantity_sold).toBe(0);

    const invAfter = await query(`SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(invAfter.rows[0].reserved_qty).toBe(0);
    expect(invAfter.rows[0].on_hand_qty).toBe(10);

    // 5. Assert checkout status = 'expired' and orders status = 'cancelled'
    const chk = await query(`SELECT status FROM checkouts WHERE id = $1`, [checkoutId]);
    expect(chk.rows[0].status).toBe('expired');

    const ord = await query(`SELECT status FROM orders WHERE checkout_id = $1`, [checkoutId]);
    expect(ord.rows.every((r) => r.status === 'cancelled')).toBe(true);
  });

  it('late payment after reservation expired prevents overselling and triggers refund compensation', async () => {
    // 1. Customer reserves 2 units
    const resRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `idemp_late_pay_${Date.now()}`)
      .send({
        items: [{ productId, flashSaleId, quantity: 2 }],
      });
    expect(resRes.status).toBe(201);
    const lateCheckoutId = resRes.body.checkoutId;

    // 2. Artificially expire and sweep the reservation
    await query(
      `UPDATE inventory_reservations
       SET expires_at = clock_timestamp() - INTERVAL '10 minutes'
       WHERE checkout_id = $1`,
      [lateCheckoutId]
    );
    await sweeper.sweepExpiredReservations(100);

    // Stock is now 0 reserved
    const invPre = await query(`SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(invPre.rows[0].reserved_qty).toBe(0);

    // 3. Another buyer reserves the newly released 10 units!
    const otherBuyerRes = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, 'hash', 'Other Buyer') RETURNING id`,
      [`other_buyer_${Date.now()}@example.com`]
    );
    const otherBuyerId = otherBuyerRes.rows[0].id;
    await query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'customer'`,
      [otherBuyerId]
    );

    const buyer2Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [otherBuyerId])).rows[0].email, password: 'Password123!' });

    // Buyer 2 reserves all 10 units
    const b2Reserve = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `idemp_buyer2_${Date.now()}`)
      .send({
        items: [{ productId, flashSaleId, quantity: 10 }],
      });
    expect(b2Reserve.status).toBe(201);

    // Flash sale is now completely reserved (10 of 10)
    const fsFull = await query(`SELECT quantity_reserved FROM flash_sales WHERE id = $1`, [flashSaleId]);
    expect(fsFull.rows[0].quantity_reserved).toBe(10);

    // 4. Now Customer 1's late payment arrives for their expired checkout!
    const latePayResult = await paymentService.processPayment({
      customerId,
      checkoutId: lateCheckoutId,
      idempotencyKey: `pay_late_test_${Date.now()}`,
      simulateStatus: 'success',
    });

    // System MUST recognize reservation was expired and queue refund without overselling!
    expect(latePayResult.status).toBe('expired_refund_queued');

    // 5. CRITICAL INVARIANT: ZERO OVERSELLING!
    // Flash sale quantity_sold must be 0, quantity_reserved must remain 10 (buyer 2's reservation)
    const fsPost = await query(`SELECT quantity_reserved, quantity_sold, quantity_limit FROM flash_sales WHERE id = $1`, [flashSaleId]);
    expect(fsPost.rows[0].quantity_reserved).toBe(10);
    expect(fsPost.rows[0].quantity_sold).toBe(0);
    expect(fsPost.rows[0].quantity_reserved + fsPost.rows[0].quantity_sold).toBeLessThanOrEqual(fsPost.rows[0].quantity_limit);

    // Inventory on_hand_qty MUST NOT drop below 10
    const invPost = await query(`SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(invPost.rows[0].on_hand_qty).toBe(10);
    expect(invPost.rows[0].reserved_qty).toBe(10);

    // Refund job was queued in outbox
    const outbox = await query(
      `SELECT job_type FROM outbox_jobs WHERE payload->>'checkout_id' = $1`,
      [lateCheckoutId]
    );
    expect(outbox.rows.some((r) => r.job_type === 'payment.refund_required')).toBe(true);
  });
});
