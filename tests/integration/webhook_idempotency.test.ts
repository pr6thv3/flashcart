import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { query } from '../../src/db/pool.js';
import { SandboxPaymentProvider } from '../../src/modules/payments/sandbox_provider.js';
import bcrypt from 'bcryptjs';

describe('Webhook Ingestion & Idempotency Integration Tests', () => {
  const provider = new SandboxPaymentProvider();
  let customerId: string;
  let customerToken: string;
  let vendorId: string;
  let productId: string;
  let checkoutId: string;

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
       VALUES ($1, $2, 'Webhook Customer') RETURNING id`,
      [`wh_cust_${Date.now()}@example.com`, passwordHash]
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
       VALUES ($1, $2, 'Webhook Vendor') RETURNING id`,
      [`wh_vend_${Date.now()}@example.com`, passwordHash]
    );
    const vProf = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Webhook Store', $2, 'approved') RETURNING id`,
      [vUser.rows[0].id, `wh-store-${Date.now()}`]
    );
    vendorId = vProf.rows[0].id;

    // Product with 50 units
    const pRes = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, 'Webhook Product', $2, $3, 'Desc', 1000, 'published') RETURNING id`,
      [vendorId, `wh-prod-${Date.now()}`, `WH-SKU-${Date.now()}`]
    );
    productId = pRes.rows[0].id;
    await query(`INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 50, 0)`, [productId]);

    // Create a pending reservation
    const reserveRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `idemp_wh_test_${Date.now()}`)
      .send({
        items: [{ productId, quantity: 2 }],
      });

    checkoutId = reserveRes.body.checkoutId;
  });

  it('rejects webhooks with missing or invalid signature with HTTP 401', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/sandbox')
      .send({ event: 'dummy' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('processes valid HMAC signed webhook and transitions order to paid', async () => {
    const eventId = `evt_wh_success_${Date.now()}`;
    const payload = provider.generateWebhookPayload({
      providerEventId: eventId,
      eventType: 'payment.captured',
      checkoutId,
      amountMinor: 2000,
    });

    const res = await request(app)
      .post('/api/v1/webhooks/sandbox')
      .set('x-sandbox-signature', payload.headers['X-Sandbox-Signature'])
      .send(JSON.parse(payload.rawBody));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.provider_event_id).toBe(eventId);

    // Verify DB transition: checkout = paid
    const chk = await query(`SELECT status FROM checkouts WHERE id = $1`, [checkoutId]);
    expect(chk.rows[0].status).toBe('paid');

    // Verify webhook event stored in payment_webhook_events with status = processed
    const whEvent = await query(
      `SELECT status FROM payment_webhook_events WHERE provider = 'sandbox' AND provider_event_id = $1`,
      [eventId]
    );
    expect(whEvent.rows[0].status).toBe('processed');

    // Inventory on_hand_qty deducted by 2 (50 - 2 = 48)
    const inv = await query(`SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(inv.rows[0].on_hand_qty).toBe(48);
    expect(inv.rows[0].reserved_qty).toBe(0);
  });

  it('safely acknowledges duplicate webhook without duplicate processing or inventory decrements', async () => {
    const eventId = `evt_duplicate_${Date.now()}`;

    // Create a new checkout
    const reserveRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `idemp_wh_dup_${Date.now()}`)
      .send({
        items: [{ productId, quantity: 1 }],
      });
    const dupCheckoutId = reserveRes.body.checkoutId;

    const payload = provider.generateWebhookPayload({
      providerEventId: eventId,
      eventType: 'payment.captured',
      checkoutId: dupCheckoutId,
      amountMinor: 1000,
    });

    // 1st delivery
    const res1 = await request(app)
      .post('/api/v1/webhooks/sandbox')
      .set('x-sandbox-signature', payload.headers['X-Sandbox-Signature'])
      .send(JSON.parse(payload.rawBody));

    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('success');

    // Stock should now be 47 (48 - 1)
    const invAfterFirst = await query(`SELECT on_hand_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(invAfterFirst.rows[0].on_hand_qty).toBe(47);

    // 2nd delivery of the EXACT same webhook event
    const res2 = await request(app)
      .post('/api/v1/webhooks/sandbox')
      .set('x-sandbox-signature', payload.headers['X-Sandbox-Signature'])
      .send(JSON.parse(payload.rawBody));

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('already_processed');
    expect(res2.body.provider_event_id).toBe(eventId);

    // Stock MUST REMAIN 47 (NO double decrement!)
    const invAfterSecond = await query(`SELECT on_hand_qty FROM inventory WHERE product_id = $1`, [productId]);
    expect(invAfterSecond.rows[0].on_hand_qty).toBe(47);

    // Orders must still have exactly 1 record for this checkout
    const ordersCount = await query(
      `SELECT count(*) FROM orders WHERE checkout_id = $1`,
      [dupCheckoutId]
    );
    expect(parseInt(ordersCount.rows[0].count, 10)).toBe(1);
  });
});
