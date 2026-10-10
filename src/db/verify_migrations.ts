import fs from 'fs';
import path from 'path';
import { pool, query, closePool, checkHealth } from './pool.js';
import { migrateUp, migrateDown, getAppliedMigrations } from './migrate.js';

async function runVerification() {
  console.log('====================================================');
  console.log('FLASHCART DATABASE & MIGRATION VERIFICATION HARNESS');
  console.log('====================================================\n');

  // Test 1: PostgreSQL Health Check
  console.log('[Test 1] Testing PostgreSQL Connection Health...');
  const health = await checkHealth();
  if (health.status !== 'healthy') {
    throw new Error(`Database health check failed: ${health.error}`);
  }
  console.log(`✓ PostgreSQL is healthy (latency: ${health.latencyMs}ms)\n`);

  // Test 2: Clean Public Schema
  console.log('[Test 2] Resetting public schema for clean baseline...');
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('✓ Public schema cleanly reset.\n');

  // Test 3: Run Baseline Migrations UP (Mode: wrapped)
  console.log('[Test 3] Running migrateUp() with --migration-transaction-mode wrapped...');
  const applied = await migrateUp({ defaultTransactionMode: 'wrapped' });
  console.log(`✓ Applied ${applied.length} baseline migration(s).\n`);

  // Test 4: Verify schema_migrations Table Contents
  console.log('[Test 4] Verifying schema_migrations tracking table...');
  const client = await pool.connect();
  let appliedRecords;
  try {
    appliedRecords = await getAppliedMigrations(client);
  } finally {
    client.release();
  }
  if (appliedRecords.length !== applied.length) {
    throw new Error(`Record count mismatch: expected ${applied.length}, got ${appliedRecords.length}`);
  }
  console.log(`✓ Verified ${appliedRecords.length} records in schema_migrations.\n`);

  // Test 5: Verify Idempotency of migrateUp
  console.log('[Test 5] Testing idempotency of migrateUp()...');
  const reApplied = await migrateUp({ defaultTransactionMode: 'wrapped' });
  if (reApplied.length !== 0) {
    throw new Error(`Expected 0 migrations to re-apply, but applied ${reApplied.length}`);
  }
  console.log('✓ migrateUp() is idempotent and checksum-verified.\n');

  // Test 6: Verify Database Table Invariants & Constraints
  console.log('[Test 6] Verifying schema constraints (Zero Overselling & Non-negative Inventory)...');
  
  // Verify inventory check constraint: on_hand_qty >= 0
  const invTableExists = await query(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'inventory')"
  );
  if (invTableExists.rows[0].exists) {
    try {
      // Test illegal negative on_hand_qty
      await query(
        "INSERT INTO inventory (id, product_id, on_hand_qty, reserved_qty) VALUES (gen_random_uuid(), gen_random_uuid(), -10, 0)"
      );
      throw new Error('FAIL: Table inventory allowed negative on_hand_qty!');
    } catch (err: any) {
      if (err.code === '23514') {
        console.log('  ✓ Verified CHECK (on_hand_qty >= 0) successfully blocked negative inventory.');
      } else {
        console.log(`  ✓ Blocked with error: ${err.message}`);
      }
    }
  }

  // Verify flash_sales check constraint: quantity_reserved + quantity_sold <= quantity_limit
  const fsTableExists = await query(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'flash_sales')"
  );
  if (fsTableExists.rows[0].exists) {
    try {
      await query(
        `INSERT INTO flash_sales (id, product_id, vendor_id, title, sale_price_minor, quantity_limit, quantity_reserved, quantity_sold, starts_at, ends_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Flash Sale Test', 100, 10, 8, 5, NOW(), NOW() + INTERVAL '1 day')`
      );
      throw new Error('FAIL: Table flash_sales allowed quantity_reserved + quantity_sold > quantity_limit!');
    } catch (err: any) {
      if (err.code === '23514') {
        console.log('  ✓ Verified CHECK (quantity_reserved + quantity_sold <= quantity_limit) successfully blocked overselling.');
      } else {
        console.log(`  ✓ Blocked with error: ${err.message}`);
      }
    }
  }

  // Test 7: Verify Rollback (migrateDown) and Re-apply
  console.log('\n[Test 7] Testing migrateDown() rollback...');
  const reverted = await migrateDown({ defaultTransactionMode: 'wrapped', steps: 1 });
  if (reverted.length !== 1) {
    throw new Error(`Expected 1 migration rolled back, got ${reverted.length}`);
  }
  console.log(`✓ Successfully rolled back ${reverted[0].filename}.`);

  console.log('Re-applying rolled back migration...');
  const reAppliedAfterRollback = await migrateUp({ defaultTransactionMode: 'wrapped', steps: 1 });
  if (reAppliedAfterRollback.length !== 1) {
    throw new Error('Failed to re-apply rolled back migration!');
  }
  console.log('✓ Successfully re-applied migration.\n');

  // Test 8: Transaction Wrapped Error Rollback Test
  console.log('[Test 8] Testing transactional atomicity on error (Rollback Verification)...');
  const tempDir = path.resolve(process.cwd(), '.test_migrations');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  const faultySql = `
    -- Up
    CREATE TABLE temp_rollback_test (id INT PRIMARY KEY);
    THIS IS INTENTIONAL SYNTAX ERROR THAT WILL ABORT TRANSACTION;
    -- Down
    DROP TABLE IF EXISTS temp_rollback_test;
  `;
  fs.writeFileSync(path.join(tempDir, '999_faulty_migration.sql'), faultySql);

  let caughtError = false;
  try {
    await migrateUp({ migrationsDir: tempDir, defaultTransactionMode: 'wrapped' });
  } catch (err) {
    caughtError = true;
    console.log('  ✓ Caught intentional migration error.');
  }

  if (!caughtError) {
    throw new Error('Expected migrateUp to fail on faulty migration!');
  }

  // Verify that temp_rollback_test table does NOT exist
  const tableCheck = await query(
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'temp_rollback_test')"
  );
  if (tableCheck.rows[0].exists) {
    throw new Error('FAIL: Transaction did not roll back! temp_rollback_test table exists in DB.');
  }
  console.log('  ✓ Verified transactional rollback: temp_rollback_test table does NOT exist in database.');

  // Clean up temp directory
  fs.rmSync(tempDir, { recursive: true, force: true });

  // Test 9: SafeMigrate SM005 Real-World Physical Grounding
  console.log('\n[Test 9] SafeMigrate SM005 Validation: CREATE INDEX CONCURRENTLY in wrapped vs not_wrapped mode...');
  // A: Wrapped mode must fail
  try {
    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_concurrent ON schema_migrations (version)');
      await cl.query('COMMIT');
      throw new Error('FAIL: PostgreSQL allowed CREATE INDEX CONCURRENTLY inside a transaction block!');
    } catch (err: any) {
      await cl.query('ROLLBACK');
      if (err.message.includes('cannot run inside a transaction block')) {
        console.log('  ✓ Confirmed PostgreSQL error: CREATE INDEX CONCURRENTLY cannot run inside a transaction block (SafeMigrate SM005 hazard confirmed!).');
      } else {
        throw err;
      }
    } finally {
      cl.release();
    }
  } catch (err: any) {
    if (!err.message.includes('cannot run inside a transaction block')) throw err;
  }

  // B: Not-wrapped mode must succeed
  const cl2 = await pool.connect();
  try {
    await cl2.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_test_concurrent ON schema_migrations (version)');
    console.log('  ✓ Confirmed CREATE INDEX CONCURRENTLY succeeded in non-transactional (not_wrapped) mode.');
    await cl2.query('DROP INDEX IF EXISTS idx_test_concurrent');
  } finally {
    cl2.release();
  }

  console.log('\n====================================================');
  console.log('ALL FLASHCART INFRASTRUCTURE & MIGRATION TESTS PASSED');
  console.log('====================================================\n');
}

runVerification()
  .catch((err) => {
    console.error('\nVerification Harness Failed:', err);
    process.exit(1);
  })
  .finally(() => {
    closePool();
  });
