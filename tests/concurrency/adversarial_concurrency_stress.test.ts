import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../../src/app.js';
import { query } from '../../src/db/pool.js';

interface BuyerFixture {
  userId: string;
  email: string;
  token: string;
}

async function createBuyerBatch(prefix: string, count: number): Promise<BuyerFixture[]> {
  const runId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  const usersRes = await query<{ id: string; email: string }>(
    `WITH inserted_users AS (
       INSERT INTO users (email, password_hash, full_name)
       SELECT
         $1 || '_' || s || '_' || $2 || '@example.com',
         'dummy_hash',
         'Adversarial Buyer ' || s
       FROM generate_series(1, $3) AS s
       RETURNING id, email
     ),
     roles_assigned AS (
       INSERT INTO user_roles (user_id, role_id)
       SELECT iu.id, r.id
       FROM inserted_users iu
       CROSS JOIN roles r
       WHERE r.name = 'customer'
     )
     SELECT id, email FROM inserted_users ORDER BY email ASC`,
    [prefix, runId, count]
  );

  const buyers: BuyerFixture[] = [];
  const userIds: string[] = [];
  const tokenHashes: string[] = [];

  for (let i = 0; i < usersRes.rows.length; i++) {
    const u = usersRes.rows[i];
    const rawToken = `sess_adv_${prefix}_${runId}_${i}_${crypto.randomBytes(8).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    userIds.push(u.id);
    tokenHashes.push(hash);
    buyers.push({
      userId: u.id,
      email: u.email,
      token: rawToken,
    });
  }

  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     SELECT unnest($1::uuid[]), unnest($2::text[]), clock_timestamp() + INTERVAL '1 day'`,
    [userIds, tokenHashes]
  );

  return buyers;
}

describe('Adversarial Concurrency Engine Stress & Invariant Probing', () => {
  const suiteId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  let vendorProfileId: string;
  let categoryId: string;

  beforeAll(async () => {
    // 1. Ensure roles
    await query(`
      INSERT INTO roles (name, description) VALUES
        ('customer', 'Customer'), ('vendor', 'Vendor'), ('admin', 'Admin')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 2. Setup baseline vendor and category
    const vUser = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, 'dummy_hash', 'Adversarial Vendor') RETURNING id`,
      [`adv_vendor_${suiteId}@example.com`]
    );
    const vProf = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Adversarial Store', $2, 'approved') RETURNING id`,
      [vUser.rows[0].id, `adv-store-${suiteId}`]
    );
    vendorProfileId = vProf.rows[0].id;

    const cat = await query<{ id: string }>(
      `INSERT INTO categories (name, slug)
       VALUES ('Adversarial Category', $1) RETURNING id`,
      [`cat-adv-${suiteId}`]
    );
    categoryId = cat.rows[0].id;
  });

  it('Scenario 1: 50 concurrent requests against 100% depleted flash sale stock yield 0 admissions and 50 HTTP 409s', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, category_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, $2, 'Depleted Item', $3, $4, 'Item with no stock left', 1000, 'published')
       RETURNING id`,
      [vendorProfileId, categoryId, `depleted-${suiteId}`, `SKU-DEPLETED-${suiteId}`]
    );
    const productId = prodRes.rows[0].id;

    await query(
      `INSERT INTO inventory (product_id, on_hand_qty, reserved_qty)
       VALUES ($1, 20, 5)`,
      [productId]
    );

    const fsRes = await query<{ id: string }>(
      `INSERT INTO flash_sales (
         product_id, vendor_id, title, sale_price_minor, currency, quantity_limit,
         quantity_reserved, quantity_sold, starts_at, ends_at, is_active
       ) VALUES (
         $1, $2, 'Already Full Flash Sale', 500, 'INR', 5,
         5, 0, clock_timestamp() - INTERVAL '5 minutes', clock_timestamp() + INTERVAL '2 hours', true
       ) RETURNING id`,
      [productId, vendorProfileId]
    );
    const flashSaleId = fsRes.rows[0].id;

    const buyers = await createBuyerBatch('depleted', 50);

    const tasks = buyers.map((buyer, idx) => async () => {
      const res = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${buyer.token}`)
        .set('Idempotency-Key', `idemp_depleted_${suiteId}_${idx}`)
        .send({
          items: [{ productId, flashSaleId, quantity: 1 }],
        });
      return { status: res.status, body: res.body };
    });

    const results = await Promise.all(tasks.map((t) => t()));

    const accepted = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    const serverErrors = results.filter((r) => r.status >= 500);

    expect(accepted.length).toBe(0);
    expect(conflicts.length).toBe(50);
    expect(serverErrors.length).toBe(0);

    for (const conf of conflicts) {
      expect(conf.body.error.code).toBe('INVENTORY_UNAVAILABLE');
    }

    // Invariant: counters remain strictly unchanged
    const fsCheck = await query<any>(
      `SELECT quantity_limit, quantity_reserved, quantity_sold FROM flash_sales WHERE id = $1`,
      [flashSaleId]
    );
    expect(fsCheck.rows[0].quantity_reserved).toBe(5);
    expect(fsCheck.rows[0].quantity_sold).toBe(0);

    const invCheck = await query<any>(
      `SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`,
      [productId]
    );
    expect(invCheck.rows[0].reserved_qty).toBe(5);
    expect(invCheck.rows[0].on_hand_qty).toBe(20);
  });

  it('Scenario 2: Deadlock Resistance — 60 concurrent multi-product checkouts with opposite item ordering succeed without 40P01 deadlocks', async () => {
    // Create Product A and Product B
    const prodA = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, category_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, $2, 'Deadlock Product A', $3, $4, 'Desc A', 1500, 'published')
       RETURNING id`,
      [vendorProfileId, categoryId, `deadlock-a-${suiteId}`, `SKU-DL-A-${suiteId}`]
    );
    const prodB = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, category_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, $2, 'Deadlock Product B', $3, $4, 'Desc B', 2500, 'published')
       RETURNING id`,
      [vendorProfileId, categoryId, `deadlock-b-${suiteId}`, `SKU-DL-B-${suiteId}`]
    );

    const idA = prodA.rows[0].id;
    const idB = prodB.rows[0].id;

    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 100, 0)`, [idA]);
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 100, 0)`, [idB]);

    const buyers = await createBuyerBatch('deadlock', 60);

    // Group 1 (first 30): payload is [Product A, Product B]
    // Group 2 (last 30): payload is [Product B, Product A] (reversed!)
    const tasks = buyers.map((buyer, idx) => async () => {
      const items =
        idx % 2 === 0
          ? [
              { productId: idA, quantity: 1 },
              { productId: idB, quantity: 1 },
            ]
          : [
              { productId: idB, quantity: 1 },
              { productId: idA, quantity: 1 },
            ];

      const res = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${buyer.token}`)
        .set('Idempotency-Key', `idemp_dl_${suiteId}_${idx}`)
        .send({ items });

      return { status: res.status, body: res.body };
    });

    const results = await Promise.all(tasks.map((t) => t()));

    const serverErrors = results.filter((r) => r.status >= 500);
    const accepted = results.filter((r) => r.status === 201);

    // Absolutely 0 deadlocks or 500 internal errors
    expect(serverErrors.length).toBe(0);
    expect(accepted.length).toBe(60);

    // Stock verification
    const invA = await query<any>(`SELECT reserved_qty FROM inventory WHERE product_id = $1`, [idA]);
    const invB = await query<any>(`SELECT reserved_qty FROM inventory WHERE product_id = $1`, [idB]);
    expect(invA.rows[0].reserved_qty).toBe(60);
    expect(invB.rows[0].reserved_qty).toBe(60);
  });

  it('Scenario 3: Stock Discrepancy — Flash sale limit (10) exceeds physical stock (4); exactly 4 succeed and 0 orphan flash sale reservations remain', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, category_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, $2, 'Low Physical Stock Item', $3, $4, 'Only 4 units in warehouse', 1200, 'published')
       RETURNING id`,
      [vendorProfileId, categoryId, `low-phys-${suiteId}`, `SKU-LOW-PHYS-${suiteId}`]
    );
    const productId = prodRes.rows[0].id;

    // Warehouse only has 4 units on hand!
    await query(
      `INSERT INTO inventory (product_id, on_hand_qty, reserved_qty)
       VALUES ($1, 4, 0)`,
      [productId]
    );

    // Flash sale says limit = 10
    const fsRes = await query<{ id: string }>(
      `INSERT INTO flash_sales (
         product_id, vendor_id, title, sale_price_minor, currency, quantity_limit,
         quantity_reserved, quantity_sold, starts_at, ends_at, is_active
       ) VALUES (
         $1, $2, 'Oversold Limit Sale', 600, 'INR', 10,
         0, 0, clock_timestamp() - INTERVAL '5 minutes', clock_timestamp() + INTERVAL '2 hours', true
       ) RETURNING id`,
      [productId, vendorProfileId]
    );
    const flashSaleId = fsRes.rows[0].id;

    const buyers = await createBuyerBatch('phys_limit', 30);

    const tasks = buyers.map((buyer, idx) => async () => {
      const res = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${buyer.token}`)
        .set('Idempotency-Key', `idemp_phys_${suiteId}_${idx}`)
        .send({
          items: [{ productId, flashSaleId, quantity: 1 }],
        });
      return { status: res.status, body: res.body };
    });

    const results = await Promise.all(tasks.map((t) => t()));

    const accepted = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    const serverErrors = results.filter((r) => r.status >= 500);

    expect(serverErrors.length).toBe(0);
    expect(accepted.length).toBe(4);
    expect(conflicts.length).toBe(26);

    // Database verification:
    // Physical inventory reserved is 4 (never exceeds 4)
    const invCheck = await query<any>(
      `SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`,
      [productId]
    );
    expect(invCheck.rows[0].reserved_qty).toBe(4);
    expect(invCheck.rows[0].on_hand_qty).toBe(4);

    // Flash sale reserved must be strictly 4 (not 10!), proving atomic rollback on inventory check failure
    const fsCheck = await query<any>(
      `SELECT quantity_reserved FROM flash_sales WHERE id = $1`,
      [flashSaleId]
    );
    expect(fsCheck.rows[0].quantity_reserved).toBe(4);
  });

  it('Scenario 4: High-Concurrency Payment Stampede — 20 simultaneous payment requests on 1 reservation decrement stock exactly once', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, category_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, $2, 'Stampede Product', $3, $4, 'Payment stampede target', 3000, 'published')
       RETURNING id`,
      [vendorProfileId, categoryId, `stampede-${suiteId}`, `SKU-STAMP-${suiteId}`]
    );
    const productId = prodRes.rows[0].id;

    await query(
      `INSERT INTO inventory (product_id, on_hand_qty, reserved_qty)
       VALUES ($1, 50, 0)`,
      [productId]
    );

    const buyers = await createBuyerBatch('stampede', 1);
    const buyer = buyers[0];

    // Create 1 reservation
    const resReserve = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${buyer.token}`)
      .set('Idempotency-Key', `idemp_stampede_${suiteId}`)
      .send({
        items: [{ productId, quantity: 1 }],
      });

    expect(resReserve.status).toBe(201);
    const checkoutId = resReserve.body.checkoutId;

    // Launch 20 concurrent payment requests on this single checkout
    const paymentTasks = Array.from({ length: 20 }, (_, idx) => async () => {
      const res = await request(app)
        .post('/api/v1/checkout/pay')
        .set('Authorization', `Bearer ${buyer.token}`)
        .send({
          checkoutId,
          paymentMethod: 'sandbox',
          simulateStatus: 'success',
        });
      return { status: res.status, body: res.body };
    });

    const paymentResults = await Promise.all(paymentTasks.map((t) => t()));

    const serverErrors = paymentResults.filter((r) => r.status >= 500);
    const successPayments = paymentResults.filter((r) => r.status === 200 && r.body.status === 'paid');

    expect(serverErrors.length).toBe(0);
    expect(successPayments.length).toBe(20); // All 20 return 200 paid (one captured, 19 return isAlreadyPaid: true)

    // Verify physical database state: on_hand_qty decremented by EXACTLY 1 (50 -> 49)
    const invCheck = await query<any>(
      `SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`,
      [productId]
    );
    expect(invCheck.rows[0].on_hand_qty).toBe(49);
    expect(invCheck.rows[0].reserved_qty).toBe(0);

    // Verify orders: exactly 1 order row for this checkout
    const orderCount = await query<any>(
      `SELECT COUNT(*) as count FROM orders WHERE checkout_id = $1`,
      [checkoutId]
    );
    expect(parseInt(orderCount.rows[0].count, 10)).toBe(1);

    // Outbox: exactly 1 order.paid event queued
    const outboxCount = await query<any>(
      `SELECT COUNT(*) as count FROM outbox_jobs WHERE payload->>'checkout_id' = $1 AND job_type = 'order.paid'`,
      [checkoutId]
    );
    expect(parseInt(outboxCount.rows[0].count, 10)).toBe(1);
  });

  it('Scenario 5: Late Payment Expiry Race — Payment on expired reservation triggers automated refund outbox and does NOT oversell', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, category_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, $2, 'Late Payment Product', $3, $4, 'Late payment target', 4000, 'published')
       RETURNING id`,
      [vendorProfileId, categoryId, `late-${suiteId}`, `SKU-LATE-${suiteId}`]
    );
    const productId = prodRes.rows[0].id;

    await query(
      `INSERT INTO inventory (product_id, on_hand_qty, reserved_qty)
       VALUES ($1, 10, 0)`,
      [productId]
    );

    const buyers = await createBuyerBatch('late_pay', 1);
    const buyer = buyers[0];

    const resReserve = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${buyer.token}`)
      .set('Idempotency-Key', `idemp_late_${suiteId}`)
      .send({
        items: [{ productId, quantity: 1 }],
      });

    expect(resReserve.status).toBe(201);
    const checkoutId = resReserve.body.checkoutId;

    // Artificially expire the reservation in DB
    await query(
      `UPDATE checkouts SET expires_at = clock_timestamp() - INTERVAL '5 minutes' WHERE id = $1`,
      [checkoutId]
    );
    await query(
      `UPDATE inventory_reservations SET expires_at = clock_timestamp() - INTERVAL '5 minutes' WHERE checkout_id = $1`,
      [checkoutId]
    );

    // Attempt payment
    const payRes = await request(app)
      .post('/api/v1/checkout/pay')
      .set('Authorization', `Bearer ${buyer.token}`)
      .send({
        checkoutId,
        paymentMethod: 'sandbox',
        simulateStatus: 'success',
      });

    expect(payRes.status).toBe(200);
    expect(payRes.body.status).toBe('expired_refund_queued');

    // Verify stock was NOT decremented: on_hand_qty is still 10!
    const invCheck = await query<any>(
      `SELECT on_hand_qty FROM inventory WHERE product_id = $1`,
      [productId]
    );
    expect(invCheck.rows[0].on_hand_qty).toBe(10);

    // Verify outbox has payment.refund_required
    const refundOutbox = await query<any>(
      `SELECT * FROM outbox_jobs WHERE payload->>'checkout_id' = $1 AND job_type = 'payment.refund_required'`,
      [checkoutId]
    );
    expect(refundOutbox.rows.length).toBe(1);
    expect(refundOutbox.rows[0].payload.reason).toBe('LATE_PAYMENT_EXPIRED_RESERVATION');
  });
});
