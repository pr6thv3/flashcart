import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { query } from '../../src/db/pool.js';
import bcrypt from 'bcryptjs';

describe('Customer Orders API (/api/v1/orders)', () => {
  let customerToken: string;
  let customerId: string;
  let otherCustomerToken: string;
  let vendorId: string;
  let productId: string;
  let orderId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    // Ensure roles exist
    await query(`
      INSERT INTO roles (name, description) VALUES
        ('customer', 'Customer'), ('vendor', 'Vendor'), ('admin', 'Admin')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Create Customer 1
    const cRes1 = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Order Customer 1') RETURNING id`,
      [`order_cust1_${Date.now()}@example.com`, passwordHash]
    );
    customerId = cRes1.rows[0].id;
    await query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'customer'`,
      [customerId]
    );

    const cLogin1 = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: (await query(`SELECT email FROM users WHERE id = $1`, [customerId])).rows[0].email,
        password: 'Password123!',
      });
    customerToken = cLogin1.body.token;

    // Create Customer 2 (for tenant isolation check)
    const cRes2 = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Order Customer 2') RETURNING id`,
      [`order_cust2_${Date.now()}@example.com`, passwordHash]
    );
    await query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'customer'`,
      [cRes2.rows[0].id]
    );

    const cLogin2 = await request(app)
      .post('/api/v1/auth/login')
      .send({
        email: (await query(`SELECT email FROM users WHERE id = $1`, [cRes2.rows[0].id])).rows[0].email,
        password: 'Password123!',
      });
    otherCustomerToken = cLogin2.body.token;

    // Create Vendor
    const vUser = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Order Test Vendor') RETURNING id`,
      [`order_vend_${Date.now()}@example.com`, passwordHash]
    );
    const vProf = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Order Store', $2, 'approved') RETURNING id`,
      [vUser.rows[0].id, `order-store-${Date.now()}`]
    );
    vendorId = vProf.rows[0].id;

    // Create Product
    const pRes = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, 'Order Test Widget', $2, $3, 'A high quality test widget', 1500, 'published') RETURNING id`,
      [vendorId, `order-widget-${Date.now()}`, `SKU-ORD-${Date.now()}`]
    );
    productId = pRes.rows[0].id;
    await query(
      `INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 50, 0)`,
      [productId]
    );

    // Reserve and Pay a Checkout for Customer 1
    const reserveRes = await request(app)
      .post('/api/v1/checkout/reserve')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', `idemp_ord_test_${Date.now()}`)
      .send({
        items: [{ productId, quantity: 2 }],
      });
    expect(reserveRes.status).toBe(201);
    const checkoutId = reserveRes.body.checkoutId;

    const payRes = await request(app)
      .post('/api/v1/checkout/pay')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        checkoutId,
        simulateStatus: 'success',
      });
    expect(payRes.status).toBe(200);

    const ordersInDb = await query<{ id: string }>(
      `SELECT id FROM orders WHERE checkout_id = $1`,
      [checkoutId]
    );
    expect(ordersInDb.rows.length).toBeGreaterThan(0);
    orderId = ordersInDb.rows[0].id;
  });

  it('rejects unauthenticated requests to /api/v1/orders', async () => {
    const res = await request(app).get('/api/v1/orders');
    expect(res.status).toBe(401);
  });

  it('lists customer orders with vendor sub-orders and items', async () => {
    const res = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const order = res.body.find((o: any) => o.id === orderId);
    expect(order).toBeDefined();
    expect(order.status).toBe('paid');
    expect(order.vendor.store_name).toBe('Order Store');
    expect(order.items.length).toBe(1);
    expect(order.items[0].product_id).toBe(productId);
    expect(order.items[0].quantity).toBe(2);
    expect(order.items[0].unit_price_minor).toBe(1500);
    expect(order.items[0].total_minor).toBe(3000);
  });

  it('fetches a single order by ID for the owning customer', async () => {
    const res = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(orderId);
    expect(res.body.vendor.store_name).toBe('Order Store');
    expect(res.body.items.length).toBe(1);
  });

  it('enforces isolation: Customer 2 cannot access Customer 1 order', async () => {
    const res = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${otherCustomerToken}`);

    expect(res.status).toBe(404);
  });
});
