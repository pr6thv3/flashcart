import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { query } from '../../src/db/pool.js';
import bcrypt from 'bcryptjs';

describe('Multi-Vendor Data Isolation & Zero-IDOR Integration Tests', () => {
  let customerToken: string;
  let vendor1Token: string;
  let vendor1Id: string;
  let vendor2Token: string;
  let vendor2Id: string;
  let suspendedVendorToken: string;
  let vendor1ProductId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    // 1. Ensure roles
    await query(`
      INSERT INTO roles (name, description) VALUES
        ('customer', 'Customer'), ('vendor', 'Vendor'), ('admin', 'Admin')
      ON CONFLICT (name) DO NOTHING;
    `);

    // 2. Create customer
    const cRes = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Customer Isolation') RETURNING id`,
      [`customer_iso_${Date.now()}@example.com`, passwordHash]
    );
    const customerId = cRes.rows[0].id;
    await query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'customer'`,
      [customerId]
    );
    const cLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [customerId])).rows[0].email, password: 'Password123!' });
    customerToken = cLogin.body.token;

    // 3. Create Vendor 1
    const v1User = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Vendor 1 User') RETURNING id`,
      [`vendor1_${Date.now()}@example.com`, passwordHash]
    );
    await query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'vendor'`,
      [v1User.rows[0].id]
    );
    const v1Prof = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Vendor 1 Store', $2, 'approved') RETURNING id`,
      [v1User.rows[0].id, `v1-store-${Date.now()}`]
    );
    vendor1Id = v1Prof.rows[0].id;

    const v1Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [v1User.rows[0].id])).rows[0].email, password: 'Password123!' });
    vendor1Token = v1Login.body.token;

    // 4. Create Vendor 2
    const v2User = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Vendor 2 User') RETURNING id`,
      [`vendor2_${Date.now()}@example.com`, passwordHash]
    );
    await query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'vendor'`,
      [v2User.rows[0].id]
    );
    const v2Prof = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Vendor 2 Store', $2, 'approved') RETURNING id`,
      [v2User.rows[0].id, `v2-store-${Date.now()}`]
    );
    vendor2Id = v2Prof.rows[0].id;

    const v2Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [v2User.rows[0].id])).rows[0].email, password: 'Password123!' });
    vendor2Token = v2Login.body.token;

    // 5. Create Suspended Vendor
    const v3User = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, 'Suspended Vendor User') RETURNING id`,
      [`vendor_susp_${Date.now()}@example.com`, passwordHash]
    );
    await query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE name = 'vendor'`,
      [v3User.rows[0].id]
    );
    await query(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Suspended Store', $2, 'suspended')`,
      [v3User.rows[0].id, `v3-susp-${Date.now()}`]
    );
    const v3Login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: (await query(`SELECT email FROM users WHERE id = $1`, [v3User.rows[0].id])).rows[0].email, password: 'Password123!' });
    suspendedVendorToken = v3Login.body.token;
  });

  it('rejects customer from accessing vendor endpoints with HTTP 403', async () => {
    const res = await request(app)
      .get('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects suspended vendor from accessing vendor endpoints with HTTP 403', async () => {
    const res = await request(app)
      .get('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${suspendedVendorToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toContain('Approved vendor profile required');
  });

  it('allows approved Vendor 1 to create product and assigns vendor_id from server context', async () => {
    const sku = `SKU-V1-${Date.now()}`;
    const slug = `v1-widget-${Date.now()}`;

    const res = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendor1Token}`)
      .send({
        title: 'Vendor 1 Widget',
        slug,
        sku,
        description: 'Test widget for V1',
        priceMinor: 4999,
        currency: 'INR',
        initialStock: 50,
        status: 'published',
      });

    expect(res.status).toBe(201);
    expect(res.body.product).toBeDefined();
    expect(res.body.product.vendor_id).toBe(vendor1Id);
    expect(res.body.product.on_hand_qty).toBe(50);
    vendor1ProductId = res.body.product.id;
  });

  it('Vendor 2 cannot view Vendor 1 product in vendor product list', async () => {
    const res = await request(app)
      .get('/api/v1/vendor/products')
      .set('Authorization', `Bearer ${vendor2Token}`);

    expect(res.status).toBe(200);
    const products = res.body.products;
    const hasV1Product = products.some((p: any) => p.id === vendor1ProductId);
    expect(hasV1Product).toBe(false);
  });

  it('Vendor 2 attempting to modify Vendor 1 product receives HTTP 404 (Zero-IDOR)', async () => {
    const res = await request(app)
      .put(`/api/v1/vendor/products/${vendor1ProductId}`)
      .set('Authorization', `Bearer ${vendor2Token}`)
      .send({
        title: 'Malicious V2 Title Overwrite',
        priceMinor: 100,
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // Verify title in DB was NOT changed
    const check = await query(`SELECT title, price_minor FROM products WHERE id = $1`, [vendor1ProductId]);
    expect(check.rows[0].title).toBe('Vendor 1 Widget');
    expect(Number(check.rows[0].price_minor)).toBe(4999);
  });

  it('Vendor 2 attempting to update inventory for Vendor 1 product receives HTTP 404', async () => {
    const res = await request(app)
      .put(`/api/v1/vendor/inventory/${vendor1ProductId}`)
      .set('Authorization', `Bearer ${vendor2Token}`)
      .send({
        onHandQty: 0,
      });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    // Verify inventory in DB was NOT changed
    const check = await query(`SELECT on_hand_qty FROM inventory WHERE product_id = $1`, [vendor1ProductId]);
    expect(check.rows[0].on_hand_qty).toBe(50);
  });
});
