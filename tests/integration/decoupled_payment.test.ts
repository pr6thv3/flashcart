import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { query } from '../../src/db/pool.js';
import bcrypt from 'bcryptjs';

describe('Decoupled Payments & State Machine Integration Tests', () => {
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
       VALUES ($1, $2, 'Pay Customer') RETURNING id`,
      [`pay_cust_${Date.now()}@example.com`, passwordHash]
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
       VALUES ($1, $2, 'Pay Vendor') RETURNING id`,
      [`pay_vend_${Date.now()}@example.com`, passwordHash]
    );
    const vProf = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Pay Store', $2, 'approved') RETURNING id`,
      [vUser.rows[0].id, `pay-store-${Date.now()}`]
    );
    vendorId = vProf.rows[0].id;

    // Product with 20 on_hand_qty
    const pRes = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, 'Pay Product', $2, $3, 'Test', 2000, 'published') RETURNING id`,
      [vendorId, `pay-prod-${Date.now()}`, `PAY-SKU-${Date.now()}`]
    );
    productId = pRes.rows[0].id;
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 20, 0)`, [productId]);

    // Flash sale with 10 units limit
    const fsRes = await query<{ id: string }>(
      `INSERT INTO flash_sales (
         product_id, vendor_id, title, sale_price_minor, quantity_limit,
         quantity_reserved, quantity_sold, starts_at, ends_at, is_active
       ) VALUES ($1, $2, 'Pay Sale', 1200, 10, 0, 0,
                 clock_timestamp() - INTERVAL '10m', clock_timestamp() + INTERVAL '2h', true)
       RETURNING id`,
      [productId, vendorId]
    );
    flashSaleId = fsRes.rows[0].id;
  });

  it('Phase A/B/C: Reserve -> Decoupled Pay -> Confirm Transitions Stock and Orders to Paid', async () => {
    // 1. Reserve 2 units
    const reserveRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `idemp_pay_success_${Date.now()}`)
      .send({
        items: [{ productId, flashSaleId, quantity: 2 }],
      });

    expect(reserveRes.status).toBe(201);
    const checkoutId = reserveRes.body.checkoutId;

    // Verify Phase A DB state: reserved, not yet sold
    const fsA = await query(`SELECT quantity_reserved, quantity_sold FROM flash_sales WHERE id = $1`, [flashSaleId]);
    expect(fsA.rows[0].quantity_reserved).toBe(2);
    expect(fsA.rows[0].quantity_sold).toBe(0);

    const invA = await query(`SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(invA.rows[0].on_hand_qty).toBe(20);
    expect(invA.rows[0].reserved_qty).toBe(2);

    // 2. Pay via POST /api/v1/checkout/pay
    const payRes = await request(app)
      .post('/api/v1/checkout/pay')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        checkoutId,
        paymentMethod: 'sandbox',
        simulateStatus: 'success',
      });

    expect(payRes.status).toBe(200);
    expect(payRes.body.status).toBe('paid');

    // 3. Verify Phase C DB state:
    // - flash_sales.quantity_reserved = 0, quantity_sold = 2
    const fsC = await query(`SELECT quantity_reserved, quantity_sold FROM flash_sales WHERE id = $1`, [flashSaleId]);
    expect(fsC.rows[0].quantity_reserved).toBe(0);
    expect(fsC.rows[0].quantity_sold).toBe(2);

    // - inventory.reserved_qty = 0, on_hand_qty = 18 (20 - 2)
    const invC = await query(`SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(invC.rows[0].reserved_qty).toBe(0);
    expect(invC.rows[0].on_hand_qty).toBe(18);

    // - inventory_reservations status = 'consumed'
    const resC = await query(`SELECT status FROM inventory_reservations WHERE checkout_id = $1`, [checkoutId]);
    expect(resC.rows.every((r) => r.status === 'consumed')).toBe(true);

    // - checkouts status = 'paid'
    const chkC = await query(`SELECT status FROM checkouts WHERE id = $1`, [checkoutId]);
    expect(chkC.rows[0].status).toBe('paid');

    // - orders status = 'paid'
    const ordC = await query(`SELECT status FROM orders WHERE checkout_id = $1`, [checkoutId]);
    expect(ordC.rows.every((r) => r.status === 'paid')).toBe(true);

    // - outbox_jobs record created
    const outboxC = await query(
      `SELECT job_type, status FROM outbox_jobs WHERE payload->>'checkout_id' = $1`,
      [checkoutId]
    );
    expect(outboxC.rows.length).toBeGreaterThan(0);
    expect(outboxC.rows[0].job_type).toBe('order.paid');

    // - audit_log record created
    const auditC = await query(
      `SELECT action FROM audit_log WHERE target_id = $1`,
      [checkoutId]
    );
    expect(auditC.rows.some((r) => r.action === 'payment.captured')).toBe(true);
  });

  it('Payment failure cleanly releases reserved stock and cancels orders', async () => {
    // 1. Reserve 1 unit
    const reserveRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `idemp_pay_fail_${Date.now()}`)
      .send({
        items: [{ productId, flashSaleId, quantity: 1 }],
      });

    expect(reserveRes.status).toBe(201);
    const checkoutId = reserveRes.body.checkoutId;

    // 2. Pay with simulated failure
    const payRes = await request(app)
      .post('/api/v1/checkout/pay')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        checkoutId,
        paymentMethod: 'sandbox',
        simulateStatus: 'failure',
      });

    expect(payRes.status).toBe(200);
    expect(payRes.body.status).toBe('failed');

    // 3. Verify stock was released back to inventory
    const fsFail = await query(`SELECT quantity_reserved, quantity_sold FROM flash_sales WHERE id = $1`, [flashSaleId]);
    expect(fsFail.rows[0].quantity_reserved).toBe(0);
    expect(fsFail.rows[0].quantity_sold).toBe(2); // Still 2 from previous test

    const invFail = await query(`SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(invFail.rows[0].reserved_qty).toBe(0);
    expect(invFail.rows[0].on_hand_qty).toBe(18); // Still 18

    // Verify reservation status = 'released'
    const resFail = await query(`SELECT status FROM inventory_reservations WHERE checkout_id = $1`, [checkoutId]);
    expect(resFail.rows.every((r) => r.status === 'released')).toBe(true);

    // Verify checkout = 'failed', orders = 'cancelled'
    const chkFail = await query(`SELECT status FROM checkouts WHERE id = $1`, [checkoutId]);
    expect(chkFail.rows[0].status).toBe('failed');

    const ordFail = await query(`SELECT status FROM orders WHERE checkout_id = $1`, [checkoutId]);
    expect(ordFail.rows.every((r) => r.status === 'cancelled')).toBe(true);
  });
});
