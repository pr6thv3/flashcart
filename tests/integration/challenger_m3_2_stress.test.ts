import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { query } from '../../src/db/pool.js';
import { ReservationSweeper } from '../../src/workers/reservation_sweeper.js';
import { PaymentService } from '../../src/modules/payments/payment_service.js';
import bcrypt from 'bcryptjs';

describe('Challenger M3.2 Empirical Stress Test Suite: Tenant Isolation, Idempotency, Sweeper & Late Payment', () => {
  const sweeper = new ReservationSweeper();
  const paymentService = new PaymentService();

  let passwordHash: string;
  let customer1Id: string;
  let customer1Token: string;
  let customer2Id: string;
  let customer2Token: string;
  let vendorAId: string;
  let vendorAToken: string;
  let vendorBId: string;
  let vendorBToken: string;
  let suspendedVendorToken: string;

  let productAId: string;
  let orderAId: string;
  let checkoutAId: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('Password123!', 10);

    // Ensure roles exist
    await query(`
      INSERT INTO roles (name, description) VALUES
        ('customer', 'Customer'), ('vendor', 'Vendor'), ('admin', 'Admin')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 1. Create Customer 1
    const c1Res = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Customer 1') RETURNING id`,
      [`c1_stress_${Date.now()}@example.com`, passwordHash]
    );
    customer1Id = c1Res.rows[0].id;
    await query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'customer'`, [customer1Id]);
    const c1Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [customer1Id])).rows[0].email, password: 'Password123!' });
    customer1Token = c1Login.body.token;

    // 2. Create Customer 2
    const c2Res = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Customer 2') RETURNING id`,
      [`c2_stress_${Date.now()}@example.com`, passwordHash]
    );
    customer2Id = c2Res.rows[0].id;
    await query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'customer'`, [customer2Id]);
    const c2Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [customer2Id])).rows[0].email, password: 'Password123!' });
    customer2Token = c2Login.body.token;

    // 3. Create Vendor A
    const vaUser = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Vendor A User') RETURNING id`,
      [`va_stress_${Date.now()}@example.com`, passwordHash]
    );
    await query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'vendor'`, [vaUser.rows[0].id]);
    const vaProf = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Store A', $2, 'approved') RETURNING id`,
      [vaUser.rows[0].id, `store-a-${Date.now()}`]
    );
    vendorAId = vaProf.rows[0].id;
    const vaLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [vaUser.rows[0].id])).rows[0].email, password: 'Password123!' });
    vendorAToken = vaLogin.body.token;

    // 4. Create Vendor B
    const vbUser = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Vendor B User') RETURNING id`,
      [`vb_stress_${Date.now()}@example.com`, passwordHash]
    );
    await query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'vendor'`, [vbUser.rows[0].id]);
    const vbProf = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Store B', $2, 'approved') RETURNING id`,
      [vbUser.rows[0].id, `store-b-${Date.now()}`]
    );
    vendorBId = vbProf.rows[0].id;
    const vbLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [vbUser.rows[0].id])).rows[0].email, password: 'Password123!' });
    vendorBToken = vbLogin.body.token;

    // 5. Create Suspended Vendor
    const vsUser = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Suspended Vendor User') RETURNING id`,
      [`vs_stress_${Date.now()}@example.com`, passwordHash]
    );
    await query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'vendor'`, [vsUser.rows[0].id]);
    await query(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Suspended Store', $2, 'suspended')`,
      [vsUser.rows[0].id, `store-susp-${Date.now()}`]
    );
    const vsLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [vsUser.rows[0].id])).rows[0].email, password: 'Password123!' });
    suspendedVendorToken = vsLogin.body.token;

    // 6. Vendor A creates Product A with stock 50
    const paRes = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, 'Vendor A Gadget', $2, $3, 'A high-tech gadget by Vendor A', 2999, 'published') RETURNING id`,
      [vendorAId, `gadget-a-${Date.now()}`, `SKU-A-${Date.now()}`]
    );
    productAId = paRes.rows[0].id;
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 50, 0)`, [productAId]);

    // 7. Customer 1 reserves Product A, creating a checkout and order for Vendor A
    const resRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customer1Token}`)
      .set('Idempotency-Key', `idemp_setup_c1_${Date.now()}`)
      .send({ items: [{ productId: productAId, quantity: 2 }] });
    expect(resRes.status).toBe(201);
    checkoutAId = resRes.body.checkoutId;
    expect(resRes.body.orders.length).toBe(1);
    orderAId = resRes.body.orders[0].orderId;
  });

  // =========================================================================
  // 1. ADVERSARIAL TENANT ISOLATION & ZERO-IDOR TESTS
  // =========================================================================
  describe('1. Adversarial Tenant Isolation & Zero-IDOR', () => {
    it('Vendor B attempting to modify Vendor A product returns HTTP 404 and leaves DB unchanged', async () => {
      const res = await request(app)
        .put(`/api/v1/vendor/products/${productAId}`)
        .set('Authorization', `Bearer ${vendorBToken}`)
        .send({
          title: 'Defaced Product Name by Vendor B',
          priceMinor: 100,
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');

      // Verify product in database was NOT modified
      const check = await query(`SELECT title, price_minor FROM products WHERE id = $1`, [productAId]);
      expect(check.rows[0].title).toBe('Vendor A Gadget');
      expect(Number(check.rows[0].price_minor)).toBe(2999);
    });

    it('Vendor B attempting to update inventory for Vendor A product returns HTTP 404 and leaves DB unchanged', async () => {
      const res = await request(app)
        .put(`/api/v1/vendor/inventory/${productAId}`)
        .set('Authorization', `Bearer ${vendorBToken}`)
        .send({ onHandQty: 0 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');

      // Verify inventory in database was NOT changed
      const check = await query(`SELECT on_hand_qty FROM inventory WHERE product_id = $1`, [productAId]);
      expect(check.rows[0].on_hand_qty).toBe(50);
    });

    it('Vendor B attempting to read Vendor A order by ID returns HTTP 404 (Zero-IDOR)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendor/orders/${orderAId}`)
        .set('Authorization', `Bearer ${vendorBToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('Vendor B attempting to fulfill/mutate Vendor A order status returns HTTP 404 and leaves DB unchanged', async () => {
      // Test PUT /orders/:id/fulfill
      const resPut = await request(app)
        .put(`/api/v1/vendor/orders/${orderAId}/fulfill`)
        .set('Authorization', `Bearer ${vendorBToken}`)
        .send({ status: 'shipped' });

      expect(resPut.status).toBe(404);
      expect(resPut.body.error.code).toBe('NOT_FOUND');

      // Test PATCH /orders/:id/fulfillment
      const resPatch = await request(app)
        .patch(`/api/v1/vendor/orders/${orderAId}/fulfillment`)
        .set('Authorization', `Bearer ${vendorBToken}`)
        .send({ status: 'delivered' });

      expect(resPatch.status).toBe(404);
      expect(resPatch.body.error.code).toBe('NOT_FOUND');

      // Verify order status in database was NOT changed
      const check = await query(`SELECT status FROM orders WHERE id = $1`, [orderAId]);
      expect(check.rows[0].status).toBe('created');
    });

    it('Vendor B listing orders does not reveal Vendor A orders', async () => {
      const res = await request(app)
        .get('/api/v1/vendor/orders')
        .set('Authorization', `Bearer ${vendorBToken}`);

      expect(res.status).toBe(200);
      const orders = res.body.orders || [];
      const hasOrderA = orders.some((o: any) => o.id === orderAId);
      expect(hasOrderA).toBe(false);
    });

    it('Non-existent resource IDs return clean HTTP 404 without leaking internal errors', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000';

      const pRes = await request(app)
        .put(`/api/v1/vendor/products/${fakeUuid}`)
        .set('Authorization', `Bearer ${vendorAToken}`)
        .send({ title: 'Nonexistent' });
      expect(pRes.status).toBe(404);

      const iRes = await request(app)
        .put(`/api/v1/vendor/inventory/${fakeUuid}`)
        .set('Authorization', `Bearer ${vendorAToken}`)
        .send({ onHandQty: 10 });
      expect(iRes.status).toBe(404);

      const oRes = await request(app)
        .get(`/api/v1/vendor/orders/${fakeUuid}`)
        .set('Authorization', `Bearer ${vendorAToken}`);
      expect(oRes.status).toBe(404);

      const fRes = await request(app)
        .put(`/api/v1/vendor/orders/${fakeUuid}/fulfill`)
        .set('Authorization', `Bearer ${vendorAToken}`)
        .send({ status: 'shipped' });
      expect(fRes.status).toBe(404);
    });

    it('Customer role and suspended vendor attempting vendor mutations are rejected with HTTP 403', async () => {
      // Customer trying to update product
      const cRes = await request(app)
        .put(`/api/v1/vendor/products/${productAId}`)
        .set('Authorization', `Bearer ${customer1Token}`)
        .send({ title: 'Hacked by Customer' });
      expect(cRes.status).toBe(403);
      expect(cRes.body.error.code).toBe('FORBIDDEN');

      // Suspended vendor trying to fulfill order
      const sRes = await request(app)
        .put(`/api/v1/vendor/orders/${orderAId}/fulfill`)
        .set('Authorization', `Bearer ${suspendedVendorToken}`)
        .send({ status: 'shipped' });
      expect(sRes.status).toBe(403);
      expect(sRes.body.error.code).toBe('FORBIDDEN');
    });

    it('Unauthenticated requests to vendor endpoints return HTTP 401', async () => {
      const res = await request(app).get('/api/v1/vendor/orders');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // =========================================================================
  // 2. ADVERSARIAL IDEMPOTENCY ENGINE TESTS
  // =========================================================================
  describe('2. Idempotency Key Stress & Invariant Tests', () => {
    it('replaying identical reservation request returns cached HTTP 200 with identical checkout details', async () => {
      const idempKey = `idemp_replay_adv_${Date.now()}`;
      const payload = {
        items: [{ productId: productAId, quantity: 1 }],
      };

      // Initial request -> 201
      const res1 = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', idempKey)
        .send(payload);

      expect(res1.status).toBe(201);
      const originalCheckoutId = res1.body.checkoutId;
      expect(res1.body.isIdempotentReplay).toBeFalsy();

      // Second identical request -> 200 cached
      const res2 = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', idempKey)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.checkoutId).toBe(originalCheckoutId);
      expect(res2.body.isIdempotentReplay).toBe(true);

      // Third identical request -> 200 cached
      const res3 = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', idempKey)
        .send(payload);

      expect(res3.status).toBe(200);
      expect(res3.body.checkoutId).toBe(originalCheckoutId);

      // Verify DB: exactly 1 checkout record with this idempotency key
      const countRes = await query(
        `SELECT count(*) FROM checkouts WHERE customer_id = $1 AND idempotency_key = $2`,
        [customer1Id, idempKey]
      );
      expect(parseInt(countRes.rows[0].count, 10)).toBe(1);
    });

    it('concurrent identical reservation requests with same key all resolve safely without double inventory allocation', async () => {
      const idempKey = `idemp_conc_burst_${Date.now()}`;
      const payload = {
        items: [{ productId: productAId, quantity: 2 }],
      };

      // Check reserved qty before
      const invBefore = await query(`SELECT reserved_qty FROM inventory WHERE product_id = $1`, [productAId]);
      const reservedBefore = invBefore.rows[0].reserved_qty;

      // Burst 10 parallel identical requests
      const promises = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/v1/checkout/reserve')
          .set('Authorization', `Bearer ${customer1Token}`)
          .set('Idempotency-Key', idempKey)
          .send(payload)
      );

      const results = await Promise.all(promises);

      // All 10 requests must safely resolve: 201 (created), 200 (cached replay), or 409 (in-flight IDEMPOTENCY_CONFLICT)
      for (const r of results) {
        expect([200, 201, 409]).toContain(r.status);
        if (r.status === 409) {
          expect(r.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
        }
      }

      // Filter successful responses and verify exactly 1 checkout ID was created
      const successfulCheckoutIds = results
        .filter((r) => r.status === 200 || r.status === 201)
        .map((r) => r.body.checkoutId);
      expect(successfulCheckoutIds.length).toBeGreaterThanOrEqual(1);
      const uniqueIds = new Set(successfulCheckoutIds);
      expect(uniqueIds.size).toBe(1);

      // Verify in DB: exactly 1 checkout row created for this customer and key
      const dbCheck = await query(
        `SELECT id FROM checkouts WHERE customer_id = $1 AND idempotency_key = $2`,
        [customer1Id, idempKey]
      );
      expect(dbCheck.rows.length).toBe(1);

      // Verify inventory was incremented by EXACTLY 2 (not 20!)
      const invAfter = await query(`SELECT reserved_qty FROM inventory WHERE product_id = $1`, [productAId]);
      expect(invAfter.rows[0].reserved_qty).toBe(reservedBefore + 2);

      // Subsequent sequential replay must return HTTP 200 with isIdempotentReplay: true
      const postReplay = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', idempKey)
        .send(payload);
      expect(postReplay.status).toBe(200);
      expect(postReplay.body.checkoutId).toBe(dbCheck.rows[0].id);
      expect(postReplay.body.isIdempotentReplay).toBe(true);
    });

    it('tampered payload with same idempotency key returns HTTP 409 IDEMPOTENCY_CONFLICT', async () => {
      const idempKey = `idemp_tamper_${Date.now()}`;

      // 1. Initial request with quantity 1
      const res1 = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', idempKey)
        .send({ items: [{ productId: productAId, quantity: 1 }] });
      expect(res1.status).toBe(201);

      // 2. Tampered request: different quantity
      const resTamperQty = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', idempKey)
        .send({ items: [{ productId: productAId, quantity: 3 }] });
      expect(resTamperQty.status).toBe(409);
      expect(resTamperQty.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

      // 3. Tampered request: empty payload
      const resTamperEmpty = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', idempKey)
        .send({});
      expect(resTamperEmpty.status).toBe(409);
      expect(resTamperEmpty.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('same idempotency key used by a different customer does NOT conflict (customer-scoped idempotency)', async () => {
      const sharedKey = `idemp_shared_key_${Date.now()}`;
      const payload = { items: [{ productId: productAId, quantity: 1 }] };

      // Customer 1 uses key
      const resC1 = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', sharedKey)
        .send(payload);
      expect(resC1.status).toBe(201);

      // Customer 2 uses identical key string
      const resC2 = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer2Token}`)
        .set('Idempotency-Key', sharedKey)
        .send(payload);
      expect(resC2.status).toBe(201);

      // Checkouts must be distinct
      expect(resC1.body.checkoutId).not.toBe(resC2.body.checkoutId);

      // Database has 2 distinct checkout records
      const c1Db = await query(`SELECT id FROM checkouts WHERE customer_id = $1 AND idempotency_key = $2`, [customer1Id, sharedKey]);
      const c2Db = await query(`SELECT id FROM checkouts WHERE customer_id = $1 AND idempotency_key = $2`, [customer2Id, sharedKey]);
      expect(c1Db.rows.length).toBe(1);
      expect(c2Db.rows.length).toBe(1);
    });

    it('missing Idempotency-Key header is rejected with HTTP 400 BAD_REQUEST', async () => {
      const res = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .send({ items: [{ productId: productAId, quantity: 1 }] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
      expect(res.body.error.message).toContain('Idempotency-Key');
    });
  });

  // =========================================================================
  // 3. DECOUPLED PAYMENT & RESERVATION SWEEPER LIFECYCLE TESTS
  // =========================================================================
  describe('3. Decoupled Payment & Reservation Sweeper Lifecycle', () => {
    it('sweeper selectively releases expired reservations while leaving active reservations untouched', async () => {
      // 1. Create a product with 20 stock
      const pRes = await query<{ id: string }>(
        `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, status)
         VALUES ($1, 'Sweeper Product', $2, $3, 'Sweeper test item', 1000, 'published') RETURNING id`,
        [vendorAId, `sweep-prod-${Date.now()}`, `SWEEP-P-${Date.now()}`]
      );
      const sweepProductId = pRes.rows[0].id;
      await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 20, 0)`, [sweepProductId]);

      // 2. Customer 1 reserves 3 units (will expire)
      const resExp = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', `idemp_will_expire_${Date.now()}`)
        .send({ items: [{ productId: sweepProductId, quantity: 3 }] });
      expect(resExp.status).toBe(201);
      const expiredCheckoutId = resExp.body.checkoutId;

      // 3. Customer 2 reserves 5 units (will remain active)
      const resAct = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer2Token}`)
        .set('Idempotency-Key', `idemp_will_stay_active_${Date.now()}`)
        .send({ items: [{ productId: sweepProductId, quantity: 5 }] });
      expect(resAct.status).toBe(201);
      const activeCheckoutId = resAct.body.checkoutId;

      // Total reserved should be 3 + 5 = 8
      const invBeforeSweep = await query(`SELECT reserved_qty FROM inventory WHERE product_id = $1`, [sweepProductId]);
      expect(invBeforeSweep.rows[0].reserved_qty).toBe(8);

      // 4. Manually set expiredCheckoutId reservations to the past
      await query(
        `UPDATE inventory_reservations
         SET expires_at = clock_timestamp() - INTERVAL '10 minutes'
         WHERE checkout_id = $1`,
        [expiredCheckoutId]
      );
      await query(
        `UPDATE checkouts
         SET expires_at = clock_timestamp() - INTERVAL '10 minutes'
         WHERE id = $1`,
        [expiredCheckoutId]
      );

      // Keep activeCheckoutId in the future
      await query(
        `UPDATE inventory_reservations
         SET expires_at = clock_timestamp() + INTERVAL '1 hour'
         WHERE checkout_id = $1`,
        [activeCheckoutId]
      );

      // 5. Execute sweeper (drain all expired reservations)
      let sweepResult = await sweeper.sweepExpiredReservations(1000);
      while ((await sweeper.sweepExpiredReservations(1000)).sweptCount > 0) {}
      expect(sweepResult.sweptCount).toBeGreaterThanOrEqual(1);

      // 6. Assert Expired Checkout state: expired and cancelled
      const chkExp = await query(`SELECT status FROM checkouts WHERE id = $1`, [expiredCheckoutId]);
      expect(chkExp.rows[0].status).toBe('expired');

      const ordExp = await query(`SELECT status FROM orders WHERE checkout_id = $1`, [expiredCheckoutId]);
      expect(ordExp.rows.every((r) => r.status === 'cancelled')).toBe(true);

      const resExpDb = await query(`SELECT status FROM inventory_reservations WHERE checkout_id = $1`, [expiredCheckoutId]);
      expect(resExpDb.rows.every((r) => r.status === 'expired')).toBe(true);

      // 7. Assert Active Checkout state: still pending and created!
      const chkAct = await query(`SELECT status FROM checkouts WHERE id = $1`, [activeCheckoutId]);
      expect(chkAct.rows[0].status).toBe('created');

      const ordAct = await query(`SELECT status FROM orders WHERE checkout_id = $1`, [activeCheckoutId]);
      expect(ordAct.rows.every((r) => r.status === 'created')).toBe(true);

      const resActDb = await query(`SELECT status FROM inventory_reservations WHERE checkout_id = $1`, [activeCheckoutId]);
      expect(resActDb.rows.every((r) => r.status === 'pending')).toBe(true);

      // 8. Assert Inventory: 3 units released, 5 units remain reserved!
      const invAfterSweep = await query(`SELECT reserved_qty, on_hand_qty FROM inventory WHERE product_id = $1`, [sweepProductId]);
      expect(invAfterSweep.rows[0].reserved_qty).toBe(5);
      expect(invAfterSweep.rows[0].on_hand_qty).toBe(20);

      // 9. Sweeper Idempotency: Immediate second sweep releases 0 further units
      const secondSweep = await sweeper.sweepExpiredReservations(100);
      expect(secondSweep.sweptCount).toBe(0);
      const invAfterSecondSweep = await query(`SELECT reserved_qty FROM inventory WHERE product_id = $1`, [sweepProductId]);
      expect(invAfterSecondSweep.rows[0].reserved_qty).toBe(5);
    });

    it('late payment for expired reservation triggers compensating refund outbox event and prevents overselling', async () => {
      // 1. Create a limited flash sale with limit = 4 units, physical inventory = 20
      const pRes = await query<{ id: string }>(
        `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, status)
         VALUES ($1, 'Late Pay Item', $2, $3, 'Item for late payment race testing', 5000, 'published') RETURNING id`,
        [vendorAId, `late-pay-prod-${Date.now()}`, `LP-SKU-${Date.now()}`]
      );
      const lpProductId = pRes.rows[0].id;
      await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 20, 0)`, [lpProductId]);

      const fsRes = await query<{ id: string }>(
        `INSERT INTO flash_sales (
           product_id, vendor_id, title, sale_price_minor, quantity_limit,
           quantity_reserved, quantity_sold, starts_at, ends_at, is_active
         ) VALUES ($1, $2, 'Late Pay Flash Sale', 2500, 4, 0, 0,
                   clock_timestamp() - INTERVAL '10m', clock_timestamp() + INTERVAL '2h', true)
         RETURNING id`,
        [lpProductId, vendorAId]
      );
      const lpFlashSaleId = fsRes.rows[0].id;

      // 2. Customer 1 reserves ALL 4 flash sale units
      const resC1 = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer1Token}`)
        .set('Idempotency-Key', `idemp_c1_late_${Date.now()}`)
        .send({ items: [{ productId: lpProductId, flashSaleId: lpFlashSaleId, quantity: 4 }] });
      expect(resC1.status).toBe(201);
      const c1CheckoutId = resC1.body.checkoutId;

      // Flash sale is fully reserved (4 of 4)
      const fsReserved = await query(`SELECT quantity_reserved FROM flash_sales WHERE id = $1`, [lpFlashSaleId]);
      expect(fsReserved.rows[0].quantity_reserved).toBe(4);

      // 3. Reservation expires and sweeper sweeps it
      await query(
        `UPDATE inventory_reservations
         SET expires_at = clock_timestamp() - INTERVAL '15 minutes'
         WHERE checkout_id = $1`,
        [c1CheckoutId]
      );
      while ((await sweeper.sweepExpiredReservations(1000)).sweptCount > 0) {}

      // Flash sale quota restored to 0 reserved
      const fsAfterSweep = await query(`SELECT quantity_reserved, quantity_sold FROM flash_sales WHERE id = $1`, [lpFlashSaleId]);
      expect(fsAfterSweep.rows[0].quantity_reserved).toBe(0);
      expect(fsAfterSweep.rows[0].quantity_sold).toBe(0);

      // 4. Customer 2 now reserves all 4 released units!
      const resC2 = await request(app)
        .post('/api/v1/checkout/reserve')
        .set('Authorization', `Bearer ${customer2Token}`)
        .set('Idempotency-Key', `idemp_c2_takeover_${Date.now()}`)
        .send({ items: [{ productId: lpProductId, flashSaleId: lpFlashSaleId, quantity: 4 }] });
      expect(resC2.status).toBe(201);

      // Flash sale quota is full again (4 of 4 reserved by Customer 2)
      const fsFullAgain = await query(`SELECT quantity_reserved FROM flash_sales WHERE id = $1`, [lpFlashSaleId]);
      expect(fsFullAgain.rows[0].quantity_reserved).toBe(4);

      // 5. Late payment arrives for Customer 1's expired checkout!
      const latePayResult = await paymentService.processPayment({
        customerId: customer1Id,
        checkoutId: c1CheckoutId,
        idempotencyKey: `late_pay_key_${Date.now()}`,
        simulateStatus: 'success',
      });

      // Must detect expired state and queue refund
      expect(latePayResult.status).toBe('expired_refund_queued');
      expect(latePayResult.checkoutId).toBe(c1CheckoutId);

      // 6. ZERO OVERSELLING INVARIANT ENFORCEMENT:
      // Flash sale must remain at 4 reserved, 0 sold, <= 4 limit
      const fsFinal = await query(`SELECT quantity_reserved, quantity_sold, quantity_limit FROM flash_sales WHERE id = $1`, [lpFlashSaleId]);
      expect(fsFinal.rows[0].quantity_reserved).toBe(4);
      expect(fsFinal.rows[0].quantity_sold).toBe(0);
      expect(fsFinal.rows[0].quantity_reserved + fsFinal.rows[0].quantity_sold).toBeLessThanOrEqual(fsFinal.rows[0].quantity_limit);

      // Warehouse physical inventory was NOT decremented for Customer 1
      const invFinal = await query(`SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`, [lpProductId]);
      expect(invFinal.rows[0].on_hand_qty).toBe(20);
      expect(invFinal.rows[0].reserved_qty).toBe(4); // from Customer 2's reservation

      // Outbox job for refund was queued
      const refundOutbox = await query(
        `SELECT job_type, payload FROM outbox_jobs WHERE payload->>'checkout_id' = $1`,
        [c1CheckoutId]
      );
      expect(refundOutbox.rows.length).toBeGreaterThanOrEqual(1);
      expect(refundOutbox.rows[0].job_type).toBe('payment.refund_required');
      expect(refundOutbox.rows[0].payload.reason).toBe('LATE_PAYMENT_EXPIRED_RESERVATION');

      // Audit log records late payment reconciliation
      const auditLog = await query(
        `SELECT action FROM audit_log WHERE target_id = $1 AND action = 'payment.late_expired_reconciled'`,
        [c1CheckoutId]
      );
      expect(auditLog.rows.length).toBe(1);

      // Payment attempt in DB recorded as failed with clear error code
      const pAttempt = await query(
        `SELECT status, error_code FROM payment_attempts WHERE checkout_id = $1`,
        [c1CheckoutId]
      );
      expect(pAttempt.rows[0].status).toBe('failed');
      expect(pAttempt.rows[0].error_code).toBe('RESERVATION_EXPIRED_REFUND_REQUIRED');
    });
  });
});
