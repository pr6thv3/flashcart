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

describe('Demonstration 2: Flash Sale 200-Concurrency & Stock Protection Proof', () => {
  const TOTAL_REQUESTS = 200;
  const SALE_LIMIT = 10;
  const INITIAL_STOCK = 100;
  const runId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

  let vendorProfileId: string;
  let categoryId: string;
  let productId: string;
  let flashSaleId: string;
  const buyers: BuyerFixture[] = [];
  let acceptedResults: Array<{ status: number; body: any; buyer: BuyerFixture }> = [];

  beforeAll(async () => {
    // 1. Ensure roles exist
    await query(`
      INSERT INTO roles (name, description) VALUES
        ('customer', 'Customer'), ('vendor', 'Vendor'), ('admin', 'Admin')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 2. Create Vendor and Approved Vendor Profile
    const vUser = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, 'dummy_hash', 'Stress Vendor') RETURNING id`,
      [`vendor_stress_${runId}@example.com`]
    );
    const vProf = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Stress Vendor Store', $2, 'approved') RETURNING id`,
      [vUser.rows[0].id, `stress-store-${runId}`]
    );
    vendorProfileId = vProf.rows[0].id;

    // 3. Create Category
    const cat = await query<{ id: string }>(
      `INSERT INTO categories (name, slug)
       VALUES ('Flash Sale Category', $1) RETURNING id`,
      [`cat-stress-${runId}`]
    );
    categoryId = cat.rows[0].id;

    // 4. Create Product with 100 on_hand_qty in Inventory
    const prod = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, category_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, $2, 'Flash Widget', $3, $4, 'Exclusive 10 units flash sale item', 2500, 'published')
       RETURNING id`,
      [vendorProfileId, categoryId, `widget-${runId}`, `SKU-FLASH-${runId}`]
    );
    productId = prod.rows[0].id;

    await query(
      `INSERT INTO inventory (product_id, on_hand_qty, reserved_qty)
       VALUES ($1, $2, 0)`,
      [productId, INITIAL_STOCK]
    );

    // 5. Create Flash Sale with quantity_limit = 10
    const fs = await query<{ id: string }>(
      `INSERT INTO flash_sales (
         product_id, vendor_id, title, sale_price_minor, currency, quantity_limit,
         quantity_reserved, quantity_sold, starts_at, ends_at, is_active
       ) VALUES (
         $1, $2, '10-Unit Lightning Flash Sale', 999, 'INR', $3,
         0, 0, clock_timestamp() - INTERVAL '5 minutes', clock_timestamp() + INTERVAL '2 hours', true
       ) RETURNING id`,
      [productId, vendorProfileId, SALE_LIMIT]
    );
    flashSaleId = fs.rows[0].id;

    // 6. Fast batch seed of 200 distinct buyer users
    const usersRes = await query<{ id: string; email: string }>(
      `WITH inserted_users AS (
         INSERT INTO users (email, password_hash, full_name)
         SELECT
           'stress_buyer_' || s || '_' || $1 || '@example.com',
           'dummy_hash',
           'Stress Buyer ' || s
         FROM generate_series(1, 200) AS s
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
      [runId]
    );

    // 7. Generate sessions for all 200 distinct buyer users
    const userIds: string[] = [];
    const tokenHashes: string[] = [];

    for (let i = 0; i < usersRes.rows.length; i++) {
      const u = usersRes.rows[i];
      const rawToken = `sess_stress_${runId}_${i}_${crypto.randomBytes(8).toString('hex')}`;
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

    expect(buyers.length).toBe(TOTAL_REQUESTS);
  });

  it(
    'Part A: 200 concurrent requests against 10 sale units produce exactly 10 reservations and 190 HTTP 409 conflicts',
    async () => {
      // Launch 200 concurrent HTTP requests simultaneously
      const tasks = buyers.map((buyer, idx) => async () => {
        const res = await request(app)
          .post('/api/v1/checkout/reserve')
          .set('Authorization', `Bearer ${buyer.token}`)
          .set('Idempotency-Key', `idemp_stress_200_${runId}_${idx}`)
          .send({
            items: [{ productId, flashSaleId, quantity: 1 }],
          });
        return {
          status: res.status,
          body: res.body,
          buyer,
        };
      });

      const results = await Promise.all(tasks.map((t) => t()));

      acceptedResults = results.filter((r) => r.status === 201);
      const conflictResults = results.filter((r) => r.status === 409);
      const serverErrors = results.filter((r) => r.status >= 500);

      // Invariant 1: Exactly 10 successful reservations
      expect(acceptedResults.length).toBe(SALE_LIMIT);

      // Invariant 2: Exactly 190 sold-out conflict rejections
      expect(conflictResults.length).toBe(TOTAL_REQUESTS - SALE_LIMIT);

      // Invariant 3: Zero unhandled 500 server errors
      expect(serverErrors.length).toBe(0);

      // Invariant 4: Every 409 conflict strictly adheres to Document 04 error envelope
      for (const conf of conflictResults) {
        expect(conf.body).toHaveProperty('error');
        expect(conf.body.error.code).toBe('INVENTORY_UNAVAILABLE');
        expect(conf.body.error.message).toMatch(/available|insufficient|sold out/i);
        expect(typeof conf.body.error.requestId).toBe('string');
      }

      // Invariant 5: Every 201 reservation includes reservation/checkout ID and sub-orders
      for (const acc of acceptedResults) {
        const checkoutId = acc.body.checkoutId || acc.body.checkout_id;
        expect(typeof checkoutId).toBe('string');
        expect(acc.body.status).toBe('created');
        expect(acc.body.orders).toBeDefined();
        expect(acc.body.orders.length).toBe(1);
      }

      // Invariant 6: Physical database state verifies exact counters
      const fsCheck = await query<{ quantity_limit: number; quantity_reserved: number; quantity_sold: number }>(
        `SELECT quantity_limit, quantity_reserved, quantity_sold FROM flash_sales WHERE id = $1`,
        [flashSaleId]
      );
      expect(fsCheck.rows[0].quantity_limit).toBe(SALE_LIMIT);
      expect(fsCheck.rows[0].quantity_reserved).toBe(SALE_LIMIT);
      expect(fsCheck.rows[0].quantity_sold).toBe(0);
      expect(fsCheck.rows[0].quantity_reserved + fsCheck.rows[0].quantity_sold).toBe(SALE_LIMIT);

      const invCheck = await query<{ on_hand_qty: number; reserved_qty: number }>(
        `SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`,
        [productId]
      );
      expect(invCheck.rows[0].reserved_qty).toBe(SALE_LIMIT);
      expect(invCheck.rows[0].on_hand_qty).toBe(INITIAL_STOCK);

      const resRows = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM inventory_reservations WHERE flash_sale_id = $1 AND status = 'pending'`,
        [flashSaleId]
      );
      expect(parseInt(resRows.rows[0].count, 10)).toBe(SALE_LIMIT);

      const chkRows = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM checkouts
         WHERE id IN (SELECT checkout_id FROM inventory_reservations WHERE flash_sale_id = $1)
           AND status = 'created'`,
        [flashSaleId]
      );
      expect(parseInt(chkRows.rows[0].count, 10)).toBe(SALE_LIMIT);
    },
    30000
  );

  it(
    'Part B: Decoupled payment conversion transitions 10 reservations to sold with 0 overselling',
    async () => {
      expect(acceptedResults.length).toBe(SALE_LIMIT);

      // Finalize sandbox payment for all 10 winning reservations
      for (const acc of acceptedResults) {
        const checkoutId = acc.body.checkoutId || acc.body.checkout_id;
        const payRes = await request(app)
          .post('/api/v1/checkout/pay')
          .set('Authorization', `Bearer ${acc.buyer.token}`)
          .send({
            checkoutId,
            paymentMethod: 'sandbox',
            simulateStatus: 'success',
          });

        expect(payRes.status).toBe(200);
        expect(payRes.body.status).toBe('paid');
        expect(payRes.body.orders).toBeDefined();
        expect(payRes.body.orders[0].status).toBe('paid');
      }

      // Assert final database physical state: stock permanently decremented
      const finalFs = await query<{ quantity_limit: number; quantity_reserved: number; quantity_sold: number }>(
        `SELECT quantity_limit, quantity_reserved, quantity_sold FROM flash_sales WHERE id = $1`,
        [flashSaleId]
      );
      expect(finalFs.rows[0].quantity_reserved).toBe(0);
      expect(finalFs.rows[0].quantity_sold).toBe(SALE_LIMIT);
      expect(finalFs.rows[0].quantity_reserved + finalFs.rows[0].quantity_sold).toBe(finalFs.rows[0].quantity_limit);

      const finalInv = await query<{ on_hand_qty: number; reserved_qty: number }>(
        `SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`,
        [productId]
      );
      expect(finalInv.rows[0].reserved_qty).toBe(0);
      expect(finalInv.rows[0].on_hand_qty).toBe(INITIAL_STOCK - SALE_LIMIT); // Exactly 90

      // Reservations transitioned to consumed
      const consumedRes = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM inventory_reservations WHERE flash_sale_id = $1 AND status = 'consumed'`,
        [flashSaleId]
      );
      expect(parseInt(consumedRes.rows[0].count, 10)).toBe(SALE_LIMIT);

      // Orders transitioned to paid
      const paidOrders = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM orders
         WHERE checkout_id IN (SELECT checkout_id FROM inventory_reservations WHERE flash_sale_id = $1)
           AND status = 'paid'`,
        [flashSaleId]
      );
      expect(parseInt(paidOrders.rows[0].count, 10)).toBe(SALE_LIMIT);

      // Zero pending reservations remaining
      const pendingRes = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM inventory_reservations WHERE flash_sale_id = $1 AND status = 'pending'`,
        [flashSaleId]
      );
      expect(parseInt(pendingRes.rows[0].count, 10)).toBe(0);
    },
    20000
  );

  it('Part C: Payment idempotency ensures re-attempt does not double-decrement inventory', async () => {
    const winner = acceptedResults[0];
    const checkoutId = winner.body.checkoutId || winner.body.checkout_id;

    const replayRes = await request(app)
      .post('/api/v1/checkout/pay')
      .set('Authorization', `Bearer ${winner.buyer.token}`)
      .send({
        checkoutId,
        paymentMethod: 'sandbox',
        simulateStatus: 'success',
      });

    expect(replayRes.status).toBe(200);
    expect(replayRes.body.status).toBe('paid');
    expect(replayRes.body.isAlreadyPaid).toBe(true);

    // Verify inventory on_hand_qty has NOT decreased below 90
    const invCheck = await query<{ on_hand_qty: number; reserved_qty: number }>(
      `SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`,
      [productId]
    );
    expect(invCheck.rows[0].on_hand_qty).toBe(INITIAL_STOCK - SALE_LIMIT);
    expect(invCheck.rows[0].reserved_qty).toBe(0);
  });
});
