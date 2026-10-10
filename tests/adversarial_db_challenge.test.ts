import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { query, pool, closePool } from '../src/db/pool.js';
import { migrateUp, loadMigrationFiles, MigrationFile } from '../src/db/migrate.js';

describe('Adversarial Database Invariants & Tamper Detection Challenge', () => {
  let customerId: string;
  let vendor1UserId: string;
  let vendor1ProfileId: string;
  let vendor2UserId: string;
  let vendor2ProfileId: string;
  let categoryId: string;
  let product1Id: string;
  let product2Id: string;
  let checkoutId: string;

  beforeAll(async () => {
    // Seed isolated test fixture entities
    const custRes = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('adv_customer@example.com', 'hashed_pw', 'Adversarial Customer')
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`
    );
    customerId = custRes.rows[0].id;

    const v1UserRes = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('adv_vendor1_user@example.com', 'hashed_pw', 'Vendor 1 User')
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`
    );
    vendor1UserId = v1UserRes.rows[0].id;

    const v1ProfileRes = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Adversarial Vendor 1', 'adv-vendor-1', 'approved')
       ON CONFLICT (user_id) DO UPDATE SET store_name = EXCLUDED.store_name
       RETURNING id`,
      [vendor1UserId]
    );
    vendor1ProfileId = v1ProfileRes.rows[0].id;

    const v2UserRes = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ('adv_vendor2_user@example.com', 'hashed_pw', 'Vendor 2 User')
       ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`
    );
    vendor2UserId = v2UserRes.rows[0].id;

    const v2ProfileRes = await query<{ id: string }>(
      `INSERT INTO vendor_profiles (user_id, store_name, slug, status)
       VALUES ($1, 'Adversarial Vendor 2', 'adv-vendor-2', 'approved')
       ON CONFLICT (user_id) DO UPDATE SET store_name = EXCLUDED.store_name
       RETURNING id`,
      [vendor2UserId]
    );
    vendor2ProfileId = v2ProfileRes.rows[0].id;

    const catRes = await query<{ id: string }>(
      `INSERT INTO categories (name, slug, description)
       VALUES ('Adversarial Category', 'adv-category', 'Test Category')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`
    );
    categoryId = catRes.rows[0].id;

    const p1Res = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, category_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, $2, 'Adversarial Product 1', 'adv-prod-1', 'ADV-SKU-001', 'Test Product 1', 1999, 'published')
       ON CONFLICT (sku) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      [vendor1ProfileId, categoryId]
    );
    product1Id = p1Res.rows[0].id;

    const p2Res = await query<{ id: string }>(
      `INSERT INTO products (vendor_id, category_id, title, slug, sku, description, price_minor, status)
       VALUES ($1, $2, 'Adversarial Product 2', 'adv-prod-2', 'ADV-SKU-002', 'Test Product 2', 2999, 'published')
       ON CONFLICT (sku) DO UPDATE SET title = EXCLUDED.title
       RETURNING id`,
      [vendor2ProfileId, categoryId]
    );
    product2Id = p2Res.rows[0].id;

    const chkRes = await query<{ id: string }>(
      `INSERT INTO checkouts (customer_id, idempotency_key, expires_at)
       VALUES ($1, 'adv-checkout-key-001', NOW() + INTERVAL '1 hour')
       ON CONFLICT (customer_id, idempotency_key) DO UPDATE SET status = 'created'
       RETURNING id`,
      [customerId]
    );
    checkoutId = chkRes.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test fixtures created in correct reverse-dependency order
    try {
      if (checkoutId) {
        await query('DELETE FROM payment_attempts WHERE checkout_id = $1', [checkoutId]);
        await query('DELETE FROM orders WHERE checkout_id = $1', [checkoutId]);
        await query('DELETE FROM checkouts WHERE id = $1', [checkoutId]);
      }
      if (product1Id) {
        await query('DELETE FROM flash_sales WHERE product_id = $1', [product1Id]);
        await query('DELETE FROM inventory WHERE product_id = $1', [product1Id]);
        await query('DELETE FROM products WHERE id = $1', [product1Id]);
      }
      if (product2Id) {
        await query('DELETE FROM inventory WHERE product_id = $1', [product2Id]);
        await query('DELETE FROM products WHERE id = $1', [product2Id]);
      }
      if (vendor1ProfileId) {
        await query('DELETE FROM vendor_profiles WHERE id = $1', [vendor1ProfileId]);
      }
      if (vendor2ProfileId) {
        await query('DELETE FROM vendor_profiles WHERE id = $1', [vendor2ProfileId]);
      }
      if (vendor1UserId) {
        await query('DELETE FROM users WHERE id = $1', [vendor1UserId]);
      }
      if (vendor2UserId) {
        await query('DELETE FROM users WHERE id = $1', [vendor2UserId]);
      }
      if (customerId) {
        await query('DELETE FROM users WHERE id = $1', [customerId]);
      }
      if (categoryId) {
        await query('DELETE FROM categories WHERE id = $1', [categoryId]);
      }
    } catch (e) {
      // Ignore cleanup error if already clean
    }
    await closePool();
  });

  describe('1. Inventory Invariants (chk_inventory_qty_invariants)', () => {
    it('rejects INSERT with negative on_hand_qty (< 0) with check violation 23514', async () => {
      let error: any;
      try {
        await query(
          'INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, -1, 0)',
          [product1Id]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('chk_inventory_qty_invariants');
    });

    it('rejects INSERT with negative reserved_qty (< 0) with check violation 23514', async () => {
      let error: any;
      try {
        await query(
          'INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 10, -1)',
          [product1Id]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('chk_inventory_qty_invariants');
    });

    it('rejects INSERT with reserved_qty > on_hand_qty with check violation 23514', async () => {
      let error: any;
      try {
        await query(
          'INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 10, 11)',
          [product1Id]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('chk_inventory_qty_invariants');
    });

    it('accepts exact zero boundary conditions (on_hand_qty = 0, reserved_qty = 0)', async () => {
      await query('DELETE FROM inventory WHERE product_id = $1', [product1Id]);
      const res = await query(
        'INSERT INTO inventory (product_id, on_hand_qty, reserved_qty) VALUES ($1, 0, 0) RETURNING on_hand_qty, reserved_qty',
        [product1Id]
      );
      expect(res.rows[0].on_hand_qty).toBe(0);
      expect(res.rows[0].reserved_qty).toBe(0);
    });

    it('accepts fully reserved boundary condition (reserved_qty == on_hand_qty)', async () => {
      const res = await query(
        'UPDATE inventory SET on_hand_qty = 50, reserved_qty = 50 WHERE product_id = $1 RETURNING on_hand_qty, reserved_qty',
        [product1Id]
      );
      expect(res.rows[0].on_hand_qty).toBe(50);
      expect(res.rows[0].reserved_qty).toBe(50);
    });

    it('rejects UPDATE when on_hand_qty is reduced below reserved_qty with check violation 23514', async () => {
      // Start with on_hand = 50, reserved = 20
      await query(
        'UPDATE inventory SET on_hand_qty = 50, reserved_qty = 20 WHERE product_id = $1',
        [product1Id]
      );

      let error: any;
      try {
        // Attempt to update on_hand to 19 while reserved is 20
        await query(
          'UPDATE inventory SET on_hand_qty = 19 WHERE product_id = $1',
          [product1Id]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('chk_inventory_qty_invariants');
    });

    it('rejects UPDATE setting reserved_qty negative with check violation 23514', async () => {
      let error: any;
      try {
        await query(
          'UPDATE inventory SET reserved_qty = -5 WHERE product_id = $1',
          [product1Id]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('chk_inventory_qty_invariants');
    });
  });

  describe('2. Flash Sale Limits & Invariants (chk_flash_sales_quantities)', () => {
    it('rejects INSERT where quantity_reserved + quantity_sold > quantity_limit with check violation 23514', async () => {
      let error: any;
      try {
        await query(
          `INSERT INTO flash_sales (
             product_id, vendor_id, title, sale_price_minor, quantity_limit, quantity_reserved, quantity_sold, starts_at, ends_at
           ) VALUES (
             $1, $2, 'Overallocated Flash Sale', 500, 10, 7, 4, NOW(), NOW() + INTERVAL '2 hours'
           )`,
          [product1Id, vendor1ProfileId]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('chk_flash_sales_quantities');
    });

    it('rejects INSERT with negative quantity_reserved (< 0) with check violation 23514', async () => {
      let error: any;
      try {
        await query(
          `INSERT INTO flash_sales (
             product_id, vendor_id, title, sale_price_minor, quantity_limit, quantity_reserved, quantity_sold, starts_at, ends_at
           ) VALUES (
             $1, $2, 'Negative Reserved Flash Sale', 500, 10, -1, 0, NOW(), NOW() + INTERVAL '2 hours'
           )`,
          [product1Id, vendor1ProfileId]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('chk_flash_sales_quantities');
    });

    it('rejects INSERT with negative quantity_sold (< 0) with check violation 23514', async () => {
      let error: any;
      try {
        await query(
          `INSERT INTO flash_sales (
             product_id, vendor_id, title, sale_price_minor, quantity_limit, quantity_reserved, quantity_sold, starts_at, ends_at
           ) VALUES (
             $1, $2, 'Negative Sold Flash Sale', 500, 10, 0, -1, NOW(), NOW() + INTERVAL '2 hours'
           )`,
          [product1Id, vendor1ProfileId]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('chk_flash_sales_quantities');
    });

    it('rejects INSERT with invalid time window (ends_at <= starts_at) with check violation 23514', async () => {
      let error: any;
      try {
        await query(
          `INSERT INTO flash_sales (
             product_id, vendor_id, title, sale_price_minor, quantity_limit, quantity_reserved, quantity_sold, starts_at, ends_at
           ) VALUES (
             $1, $2, 'Inverted Time Window Flash Sale', 500, 10, 0, 0, NOW() + INTERVAL '1 hour', NOW()
           )`,
          [product1Id, vendor1ProfileId]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('chk_flash_sales_time_window');
    });

    it('accepts exact limit boundary condition (quantity_reserved + quantity_sold == quantity_limit)', async () => {
      await query('DELETE FROM flash_sales WHERE product_id = $1', [product1Id]);
      const res = await query<{ id: string; quantity_limit: number; quantity_reserved: number; quantity_sold: number }>(
        `INSERT INTO flash_sales (
           product_id, vendor_id, title, sale_price_minor, quantity_limit, quantity_reserved, quantity_sold, starts_at, ends_at
         ) VALUES (
           $1, $2, 'Exact Cap Flash Sale', 500, 10, 6, 4, NOW(), NOW() + INTERVAL '2 hours'
         ) RETURNING id, quantity_limit, quantity_reserved, quantity_sold`,
        [product1Id, vendor1ProfileId]
      );
      expect(res.rows[0].quantity_limit).toBe(10);
      expect(res.rows[0].quantity_reserved).toBe(6);
      expect(res.rows[0].quantity_sold).toBe(4);
      expect(res.rows[0].quantity_reserved + res.rows[0].quantity_sold).toBe(10);

      const saleId = res.rows[0].id;

      // Attempt UPDATE that breaches cap (reserved 7 + sold 4 = 11 > 10)
      let updateError: any;
      try {
        await query('UPDATE flash_sales SET quantity_reserved = 7 WHERE id = $1', [saleId]);
      } catch (err: any) {
        updateError = err;
      }
      expect(updateError).toBeDefined();
      expect(updateError.code).toBe('23514');
      expect(updateError.constraint).toBe('chk_flash_sales_quantities');
    });
  });

  describe('3. Multi-Vendor Sub-Orders Uniqueness (uq_orders_checkout_vendor)', () => {
    it('accepts distinct vendor sub-orders under the same checkout', async () => {
      await query('DELETE FROM orders WHERE checkout_id = $1', [checkoutId]);

      // Vendor 1 sub-order under checkout
      const ord1 = await query(
        `INSERT INTO orders (
           checkout_id, vendor_id, customer_id, order_number, shipping_address_snapshot
         ) VALUES (
           $1, $2, $3, 'ORD-ADV-V1-001', '{"city": "Bangalore"}'::jsonb
         ) RETURNING id`,
        [checkoutId, vendor1ProfileId, customerId]
      );
      expect(ord1.rows[0].id).toBeDefined();

      // Vendor 2 sub-order under the same checkout
      const ord2 = await query(
        `INSERT INTO orders (
           checkout_id, vendor_id, customer_id, order_number, shipping_address_snapshot
         ) VALUES (
           $1, $2, $3, 'ORD-ADV-V2-002', '{"city": "Bangalore"}'::jsonb
         ) RETURNING id`,
        [checkoutId, vendor2ProfileId, customerId]
      );
      expect(ord2.rows[0].id).toBeDefined();
    });

    it('rejects duplicate (checkout_id, vendor_id) sub-orders with unique violation 23505', async () => {
      let error: any;
      try {
        // Attempt duplicate order for vendor 1 under same checkout
        await query(
          `INSERT INTO orders (
             checkout_id, vendor_id, customer_id, order_number, shipping_address_snapshot
           ) VALUES (
             $1, $2, $3, 'ORD-ADV-V1-DUPLICATE', '{"city": "Bangalore"}'::jsonb
           )`,
          [checkoutId, vendor1ProfileId, customerId]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23505');
      expect(error.constraint).toBe('uq_orders_checkout_vendor');
    });
  });

  describe('4. Webhook Deduplication & Idempotency (uq_webhook_provider_event)', () => {
    it('accepts the initial webhook event', async () => {
      await query("DELETE FROM payment_webhook_events WHERE provider_event_id = 'evt_adv_test_001'");

      const res = await query(
        `INSERT INTO payment_webhook_events (
           provider, provider_event_id, event_type, payload
         ) VALUES (
           'stripe', 'evt_adv_test_001', 'payment_intent.succeeded', '{"amount": 1000}'::jsonb
         ) RETURNING id`,
      );
      expect(res.rows[0].id).toBeDefined();
    });

    it('accepts the same event ID from a different provider', async () => {
      const res = await query(
        `INSERT INTO payment_webhook_events (
           provider, provider_event_id, event_type, payload
         ) VALUES (
           'razorpay', 'evt_adv_test_001', 'order.paid', '{"amount": 1000}'::jsonb
         ) RETURNING id`,
      );
      expect(res.rows[0].id).toBeDefined();
    });

    it('rejects duplicate (provider, provider_event_id) with unique violation 23505', async () => {
      let error: any;
      try {
        await query(
          `INSERT INTO payment_webhook_events (
             provider, provider_event_id, event_type, payload
           ) VALUES (
             'stripe', 'evt_adv_test_001', 'payment_intent.succeeded', '{"amount": 1000}'::jsonb
           )`,
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23505');
      expect(error.constraint).toBe('uq_webhook_provider_event');
    });
  });

  describe('5. Payment Attempts Idempotency (uq_payment_attempts_idempotency)', () => {
    it('accepts the initial payment attempt for a checkout', async () => {
      await query('DELETE FROM payment_attempts WHERE checkout_id = $1', [checkoutId]);

      const res = await query(
        `INSERT INTO payment_attempts (
           checkout_id, provider, idempotency_key, amount_minor
         ) VALUES (
           $1, 'sandbox', 'pay_idemp_key_999', 1999
         ) RETURNING id`,
        [checkoutId]
      );
      expect(res.rows[0].id).toBeDefined();
    });

    it('rejects duplicate (checkout_id, idempotency_key) with unique violation 23505', async () => {
      let error: any;
      try {
        await query(
          `INSERT INTO payment_attempts (
             checkout_id, provider, idempotency_key, amount_minor
           ) VALUES (
             $1, 'sandbox', 'pay_idemp_key_999', 1999
           )`,
          [checkoutId]
        );
      } catch (err: any) {
        error = err;
      }
      expect(error).toBeDefined();
      expect(error.code).toBe('23505');
      expect(error.constraint).toBe('uq_payment_attempts_idempotency');
    });
  });

  describe('6. Migration Tamper Detection & Checksum Integrity', () => {
    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    const targetFile = path.join(migrationsDir, '005_audit_outbox.sql');

    it('detects on-disk checksum tampering of applied migrations (upSql alteration) and halts migrateUp', async () => {
      const originalContent = fs.readFileSync(targetFile, 'utf8');

      try {
        // Tamper with the Up section of migration 005
        const tamperedContent = originalContent.replace(
          '-- Migration 005: Audit Log and Outbox Jobs',
          '-- Migration 005: Audit Log and Outbox Jobs (TAMPERED_BY_CHALLENGER)'
        );
        fs.writeFileSync(targetFile, tamperedContent, 'utf8');

        let error: any;
        try {
          await migrateUp({ migrationsDir, defaultTransactionMode: 'wrapped' });
        } catch (err: any) {
          error = err;
        }

        expect(error).toBeDefined();
        expect(error.message).toContain('[Migration Integrity Error]');
        expect(error.message).toContain("Checksum mismatch for migration '005'");
        expect(error.message).toContain('Migration files must not be altered once applied');
      } finally {
        // Restore original content
        fs.writeFileSync(targetFile, originalContent, 'utf8');
      }

      // Verify that after restoring, migrateUp runs cleanly and detects no pending or invalid files
      const cleanRun = await migrateUp({ migrationsDir, defaultTransactionMode: 'wrapped' });
      expect(cleanRun).toHaveLength(0);
    });

    it('detects database-side checksum tampering in schema_migrations table', async () => {
      const rec = await query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE version = '005'"
      );
      const originalChecksum = rec.rows[0].checksum;
      const fakeChecksum = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      try {
        // Tamper with recorded checksum in database
        await query(
          "UPDATE schema_migrations SET checksum = $1 WHERE version = '005'",
          [fakeChecksum]
        );

        let error: any;
        try {
          await migrateUp({ migrationsDir, defaultTransactionMode: 'wrapped' });
        } catch (err: any) {
          error = err;
        }

        expect(error).toBeDefined();
        expect(error.message).toContain('[Migration Integrity Error]');
        expect(error.message).toContain("Checksum mismatch for migration '005'");
      } finally {
        // Restore genuine checksum
        await query(
          "UPDATE schema_migrations SET checksum = $1 WHERE version = '005'",
          [originalChecksum]
        );
      }

      // Verify clean state
      const cleanRun = await migrateUp({ migrationsDir, defaultTransactionMode: 'wrapped' });
      expect(cleanRun).toHaveLength(0);
    });
  });

  describe('7. Transactional Atomicity and Rollback on Migration Error', () => {
    it('rolls back completely when a wrapped migration encounters a syntax error', async () => {
      const tempDir = path.resolve(process.cwd(), '.temp_adv_rollback_test');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

      const faultySql = `
        -- Up
        CREATE TABLE canary_adv_rollback (id SERIAL PRIMARY KEY, note VARCHAR(50));
        INSERT INTO canary_adv_rollback (note) VALUES ('canary alive');
        INVALID_SQL_OPERATION_SYNTAX_ERROR_ABORT;
        -- Down
        DROP TABLE IF EXISTS canary_adv_rollback;
      `;
      fs.writeFileSync(path.join(tempDir, '999_adv_faulty.sql'), faultySql, 'utf8');

      let caughtError = false;
      try {
        await migrateUp({ migrationsDir: tempDir, defaultTransactionMode: 'wrapped' });
      } catch (err: any) {
        caughtError = true;
      }
      expect(caughtError).toBe(true);

      // Verify table does not exist
      const tableCheck = await query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'canary_adv_rollback')"
      );
      expect(tableCheck.rows[0].exists).toBe(false);

      // Verify schema_migrations does not have entry for 999
      const migCheck = await query(
        "SELECT EXISTS (SELECT FROM schema_migrations WHERE version = '999')"
      );
      expect(migCheck.rows[0].exists).toBe(false);

      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
