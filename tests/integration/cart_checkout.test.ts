import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { query } from '../../src/db/pool.js';
import bcrypt from 'bcryptjs';

describe('Cart & Multi-Vendor Checkout Order Splitting Integration Tests', () => {
  let customerId: string;
  let customerToken: string;
  let vendor1Id: string;
  let vendor2Id: string;
  let product1Id: string;
  let product2Id: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Roles
    await query(`
      INSERT INTO roles (name, description) VALUES
        ('customer', 'Customer'), ('vendor', 'Vendor'), ('admin', 'Admin')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 2. Customer
    const cRes = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Cart Customer') RETURNING id`,
      [`cart_cust_${Date.now()}@example.com`, passwordHash]
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

    // 3. Vendor 1 & Product 1 (Price: 1500 minor)
    const v1User = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Vendor 1') RETURNING id`,
      [`v1_cart_${Date.now()}@example.com`, passwordHash]
    );
    const v1Prof = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'V1 Cart Store', $2, 'approved') RETURNING id`,
      [v1User.rows[0].id, `v1-cart-store-${Date.now()}`]
    );
    vendor1Id = v1Prof.rows[0].id;

    const p1Res = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, 'Product One', $2, $3, 'Description 1', 1500, 'published') RETURNING id`,
      [vendor1Id, `p1-slug-${Date.now()}`, `P1-SKU-${Date.now()}`]
    );
    product1Id = p1Res.rows[0].id;
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 50, 0)`, [product1Id]);

    // 4. Vendor 2 & Product 2 (Price: 3500 minor)
    const v2User = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Vendor 2') RETURNING id`,
      [`v2_cart_${Date.now()}@example.com`, passwordHash]
    );
    const v2Prof = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'V2 Cart Store', $2, 'approved') RETURNING id`,
      [v2User.rows[0].id, `v2-cart-store-${Date.now()}`]
    );
    vendor2Id = v2Prof.rows[0].id;

    const p2Res = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, 'Product Two', $2, $3, 'Description 2', 3500, 'published') RETURNING id`,
      [vendor2Id, `p2-slug-${Date.now()}`, `P2-SKU-${Date.now()}`]
    );
    product2Id = p2Res.rows[0].id;
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 50, 0)`, [product2Id]);
  });

  it('adds items from two different vendors and calculates authoritative server prices', async () => {
    // Add 2 of Product 1 (2 * 1500 = 3000)
    const add1 = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: product1Id, quantity: 2 });
    expect(add1.status).toBe(200);

    // Add 1 of Product 2 (1 * 3500 = 3500)
    const add2 = await request(app)
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: product2Id, quantity: 1 });
    expect(add2.status).toBe(200);

    // Fetch cart
    const cartRes = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(cartRes.status).toBe(200);
    expect(cartRes.body.item_count).toBe(3);
    // Subtotal must be revalidated: 3000 + 3500 = 6500 minor
    expect(cartRes.body.subtotal_minor).toBe(6500);
    expect(cartRes.body.items_by_vendor.length).toBe(2);
  });

  it('reserves checkout and creates distinct vendor sub-orders with UNIQUE(checkout_id, vendor_id)', async () => {
    const idempKey = `idemp_cart_split_${Date.now()}`;

    const res = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', idempKey)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.checkoutId).toBeDefined();
    expect(res.body.totalMinor).toBe(6500);
    expect(res.body.status).toBe('created');

    // Orders array must contain exactly 2 orders (1 per vendor)
    expect(res.body.orders.length).toBe(2);
    const vendorIdsInResponse = res.body.orders.map((o: any) => o.vendorId);
    expect(vendorIdsInResponse).toContain(vendor1Id);
    expect(vendorIdsInResponse).toContain(vendor2Id);

    // Verify database constraint and physical state
    const checkoutId = res.body.checkoutId;

    // 1 Parent checkout
    const checkoutsDb = await query(`SELECT * FROM checkouts WHERE id = $1`, [checkoutId]);
    expect(checkoutsDb.rows.length).toBe(1);
    expect(checkoutsDb.rows[0].status).toBe('created');

    // Exactly 2 vendor sub-orders in orders table
    const ordersDb = await query(
      `SELECT vendor_id, total_minor, status FROM orders WHERE checkout_id = $1`,
      [checkoutId]
    );
    expect(ordersDb.rows.length).toBe(2);

    // Verify NO duplicate (checkout_id, vendor_id)
    const dups = await query(
      `SELECT vendor_id, COUNT(*) FROM orders WHERE checkout_id = $1 GROUP BY vendor_id HAVING COUNT(*) > 1`,
      [checkoutId]
    );
    expect(dups.rows.length).toBe(0);

    // Verify inventory reservations created
    const resDb = await query(
      `SELECT product_id, quantity, status FROM inventory_reservations WHERE checkout_id = $1`,
      [checkoutId]
    );
    expect(resDb.rows.length).toBe(2);
    expect(resDb.rows.every((r) => r.status === 'pending')).toBe(true);

    // Verify warehouse inventory reserved_qty incremented
    const inv1 = await query(`SELECT reserved_qty FROM inventory WHERE product_id = $1`, [product1Id]);
    expect(inv1.rows[0].reserved_qty).toBe(2);
    const inv2 = await query(`SELECT reserved_qty FROM inventory WHERE product_id = $1`, [product2Id]);
    expect(inv2.rows[0].reserved_qty).toBe(1);

    // Verify customer cart items were cleared upon checkout
    const cartCheck = await request(app)
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(cartCheck.body.items.length).toBe(0);
  });

  it('replaying the identical checkout request with same Idempotency-Key returns idempotent replay (HTTP 200)', async () => {
    const idempKey = `idemp_replay_test_${Date.now()}`;
    const payload = {
      items: [{ productId: product1Id, quantity: 1 }],
    };

    // First request
    const firstRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', idempKey)
      .send(payload);

    expect(firstRes.status).toBe(201);
    const checkoutId = firstRes.body.checkoutId;

    // Second request with SAME idempotency key and SAME payload
    const secondRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', idempKey)
      .send(payload);

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.checkoutId).toBe(checkoutId);
    expect(secondRes.body.isIdempotentReplay).toBe(true);

    // Verify in database: NO double allocation occurred!
    const checkoutsCount = await query(
      `SELECT count(*) FROM checkouts WHERE customer_id = $1 AND idempotency_key = $2`,
      [customerId, idempKey]
    );
    expect(parseInt(checkoutsCount.rows[0].count, 10)).toBe(1);
  });

  it('reusing an existing Idempotency-Key with a differing payload returns HTTP 409 IDEMPOTENCY_CONFLICT', async () => {
    const idempKey = `idemp_conflict_test_${Date.now()}`;

    // First request
    await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', idempKey)
      .send({ items: [{ productId: product1Id, quantity: 1 }] });

    // Second request with SAME key but DIFFERENT quantity
    const conflictRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', idempKey)
      .send({ items: [{ productId: product1Id, quantity: 5 }] });

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
