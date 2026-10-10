import { describe, it, expect, afterAll } from 'vitest';
import { query, checkHealth, closePool } from '../src/db/pool.js';
import { loadMigrationFiles } from '../src/db/migrate.js';

describe('FlashCart Database Migrations & Invariants', () => {
  afterAll(async () => {
    await closePool();
  });

  it('connects to healthy PostgreSQL 17 instance', async () => {
    const health = await checkHealth();
    expect(health.status).toBe('healthy');
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('contains exactly 24 application tables plus schema_migrations', async () => {
    const res = await query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != 'schema_migrations' ORDER BY table_name ASC"
    );
    const tableNames = res.rows.map((r) => r.table_name);
    expect(tableNames).toHaveLength(24);

    const expectedTables = [
      'addresses',
      'audit_log',
      'cart_items',
      'carts',
      'categories',
      'checkout_items',
      'checkouts',
      'flash_sales',
      'inventory',
      'inventory_reservations',
      'order_items',
      'order_status_history',
      'orders',
      'outbox_jobs',
      'payment_attempts',
      'payment_webhook_events',
      'product_images',
      'products',
      'refunds',
      'roles',
      'sessions',
      'user_roles',
      'users',
      'vendor_profiles',
    ];
    expect(tableNames).toEqual(expectedTables);
  });

  it('strictly enforces inventory non-negative check constraint (chk_inventory_qty_invariants)', async () => {
    let errorCode: string | undefined;
    try {
      await query(
        'INSERT INTO inventory (id, product_id, on_hand_qty, reserved_qty) VALUES (gen_random_uuid(), gen_random_uuid(), -5, 0)'
      );
    } catch (err: any) {
      errorCode = err.code;
    }
    expect(errorCode).toBe('23514'); // check_violation
  });

  it('strictly enforces inventory reserved_qty <= on_hand_qty check constraint', async () => {
    let errorCode: string | undefined;
    try {
      await query(
        'INSERT INTO inventory (id, product_id, on_hand_qty, reserved_qty) VALUES (gen_random_uuid(), gen_random_uuid(), 10, 15)'
      );
    } catch (err: any) {
      errorCode = err.code;
    }
    expect(errorCode).toBe('23514'); // check_violation
  });

  it('strictly enforces flash sale quantity limit check constraint (chk_flash_sales_quantities)', async () => {
    let errorCode: string | undefined;
    try {
      await query(
        `INSERT INTO flash_sales (id, product_id, vendor_id, title, sale_price_minor, quantity_limit, quantity_reserved, quantity_sold, starts_at, ends_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Oversold Flash Sale', 500, 10, 6, 5, NOW(), NOW() + INTERVAL '2 hours')`
      );
    } catch (err: any) {
      errorCode = err.code;
    }
    expect(errorCode).toBe('23514'); // check_violation
  });

  it('strictly enforces flash sale time window invariant (ends_at > starts_at)', async () => {
    let errorCode: string | undefined;
    try {
      await query(
        `INSERT INTO flash_sales (id, product_id, vendor_id, title, sale_price_minor, quantity_limit, quantity_reserved, quantity_sold, starts_at, ends_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Invalid Window Sale', 500, 10, 0, 0, NOW(), NOW() - INTERVAL '1 hour')`
      );
    } catch (err: any) {
      errorCode = err.code;
    }
    expect(errorCode).toBe('23514'); // check_violation
  });

  it('records all 5 migrations in schema_migrations with valid checksums', async () => {
    const res = await query<{ version: string; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC'
    );
    expect(res.rows).toHaveLength(5);

    const files = loadMigrationFiles();
    expect(files).toHaveLength(5);

    for (let i = 0; i < files.length; i++) {
      expect(res.rows[i].version).toBe(files[i].version);
      expect(res.rows[i].checksum).toBe(files[i].checksum);
    }
  });

  it('verifies foreign key index coverage for critical relational paths', async () => {
    const res = await query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'"
    );
    const indexNames = new Set(res.rows.map((r) => r.indexname));

    const requiredFkIndexes = [
      'idx_user_roles_user_id',
      'idx_user_roles_role_id',
      'idx_sessions_user_id',
      'idx_vendor_profiles_user_id',
      'idx_vendor_profiles_approved_by',
      'idx_addresses_user_id',
      'idx_categories_parent_id',
      'idx_products_vendor_id',
      'idx_products_category_id',
      'idx_product_images_product_id',
      'idx_inventory_product_id',
      'idx_flash_sales_product_id',
      'idx_flash_sales_vendor_id',
      'idx_carts_user_id',
      'idx_cart_items_cart_id',
      'idx_cart_items_product_id',
      'idx_checkouts_customer_id',
      'idx_checkouts_shipping_address_id',
      'idx_checkout_items_checkout_id',
      'idx_checkout_items_product_id',
      'idx_checkout_items_vendor_id',
      'idx_checkout_items_flash_sale_id',
      'idx_orders_checkout_id',
      'idx_orders_vendor_id',
      'idx_orders_customer_id',
      'idx_order_items_order_id',
      'idx_order_items_product_id',
      'idx_order_items_flash_sale_id',
      'idx_inventory_reservations_checkout_id',
      'idx_inventory_reservations_product_id',
      'idx_inventory_reservations_flash_sale_id',
      'idx_payment_attempts_checkout_id',
      'idx_refunds_order_id',
      'idx_refunds_payment_attempt_id',
      'idx_order_status_history_order_id',
      'idx_order_status_history_actor_id',
      'idx_audit_log_actor_id',
    ];

    for (const expectedIdx of requiredFkIndexes) {
      expect(indexNames.has(expectedIdx), `Missing index: ${expectedIdx}`).toBe(true);
    }
  });
});
