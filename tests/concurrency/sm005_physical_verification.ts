import { pool, getClient, query, closePool } from '../../src/db/pool.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface SM005VerificationReport {
  postgresVersion: string;
  testCases: {
    name: string;
    passed: boolean;
    details: any;
  }[];
}

async function runSM005Verification(): Promise<boolean> {
  console.log('================================================================');
  console.log('FLASHCART PHYSICAL VERIFICATION: SM005 CONCURRENTLY HAZARD IN PG17');
  console.log('================================================================\n');

  let allPassed = true;

  // Step 0: Detect PostgreSQL Version
  const versionRes = await query('SELECT version()');
  const pgVersionStr = versionRes.rows[0].version;
  console.log(`[Target Database] ${pgVersionStr}\n`);

  if (!pgVersionStr.includes('PostgreSQL 17')) {
    console.warn(`[Warning] Database is not PostgreSQL 17: ${pgVersionStr}`);
  }

  // Ensure test table exists for index operations
  await query(`
    CREATE TABLE IF NOT EXISTS sm005_test_table (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      test_val VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT clock_timestamp()
    );
  `);

  // --------------------------------------------------------------------------
  // TEST CASE 1: Physical Failure of CREATE INDEX CONCURRENTLY in Transaction Block
  // --------------------------------------------------------------------------
  console.log('[Test Case 1] Physical verification: CREATE INDEX CONCURRENTLY inside BEGIN / COMMIT...');
  {
    const client = await getClient();
    let caughtError: any = null;
    let postErrorAbortStateCaught = false;

    try {
      await client.query('BEGIN');
      try {
        await client.query('CREATE INDEX CONCURRENTLY idx_sm005_wrapped ON sm005_test_table (test_val)');
      } catch (err: any) {
        caughtError = err;
        // Verify transaction is in aborted state
        try {
          await client.query('SELECT 1');
        } catch (abortErr: any) {
          if (abortErr.code === '25P02') { // in_failed_sql_transaction
            postErrorAbortStateCaught = true;
          }
        }
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    console.log(`  -> Caught Error: ${caughtError ? caughtError.message : 'NONE'}`);
    console.log(`  -> SQLSTATE Code: ${caughtError?.code}`);
    console.log(`  -> Severity: ${caughtError?.severity}`);
    console.log(`  -> Subsequent query caught in aborted transaction (25P02): ${postErrorAbortStateCaught}`);

    const expectedMessage = 'CREATE INDEX CONCURRENTLY cannot run inside a transaction block';
    const isExpected =
      caughtError &&
      caughtError.code === '25001' && // active_sql_transaction
      caughtError.message.includes(expectedMessage) &&
      postErrorAbortStateCaught;

    if (isExpected) {
      console.log('  PASS: PostgreSQL 17 physically rejected CREATE INDEX CONCURRENTLY inside transaction block with SQLSTATE 25001.\n');
    } else {
      console.error('  FAIL: Did not observe expected error behavior in PostgreSQL 17!');
      allPassed = false;
    }
  }

  // --------------------------------------------------------------------------
  // TEST CASE 2: Physical Failure of DROP INDEX CONCURRENTLY in Transaction Block
  // --------------------------------------------------------------------------
  console.log('[Test Case 2] Physical verification: DROP INDEX CONCURRENTLY inside BEGIN / COMMIT...');
  {
    // First create a non-concurrent index to drop
    await query('CREATE INDEX IF NOT EXISTS idx_sm005_to_drop ON sm005_test_table (test_val)');

    const client = await getClient();
    let caughtError: any = null;

    try {
      await client.query('BEGIN');
      try {
        await client.query('DROP INDEX CONCURRENTLY idx_sm005_to_drop');
      } catch (err: any) {
        caughtError = err;
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // Clean up index outside transaction
    await query('DROP INDEX IF EXISTS idx_sm005_to_drop');

    console.log(`  -> Caught Error: ${caughtError ? caughtError.message : 'NONE'}`);
    console.log(`  -> SQLSTATE Code: ${caughtError?.code}`);

    const expectedMessage = 'DROP INDEX CONCURRENTLY cannot run inside a transaction block';
    const isExpected =
      caughtError &&
      caughtError.code === '25001' &&
      caughtError.message.includes(expectedMessage);

    if (isExpected) {
      console.log('  PASS: PostgreSQL 17 physically rejected DROP INDEX CONCURRENTLY inside transaction block.\n');
    } else {
      console.error('  FAIL: Expected DROP INDEX CONCURRENTLY to fail inside transaction block!');
      allPassed = false;
    }
  }

  // --------------------------------------------------------------------------
  // TEST CASE 3: Physical Success of CREATE INDEX CONCURRENTLY in Not-Wrapped Mode
  // --------------------------------------------------------------------------
  console.log('[Test Case 3] Physical verification: CREATE INDEX CONCURRENTLY in non-transactional mode...');
  {
    const client = await getClient();
    let success = false;
    let indexValidInCatalog = false;

    try {
      // Execute directly without BEGIN/COMMIT
      await client.query('CREATE INDEX CONCURRENTLY idx_sm005_not_wrapped ON sm005_test_table (test_val)');
      success = true;

      // Verify in pg_catalog.pg_indexes and pg_index (indisvalid = true)
      const catalogRes = await client.query(`
        SELECT i.relname AS index_name, idx.indisvalid
        FROM pg_class i
        JOIN pg_index idx ON idx.indexrelid = i.oid
        JOIN pg_class t ON t.oid = idx.indrelid
        WHERE t.relname = 'sm005_test_table' AND i.relname = 'idx_sm005_not_wrapped';
      `);

      if (catalogRes.rows.length === 1 && catalogRes.rows[0].indisvalid === true) {
        indexValidInCatalog = true;
      }

      // Cleanup
      await client.query('DROP INDEX CONCURRENTLY idx_sm005_not_wrapped');
    } catch (err: any) {
      console.error('  Unexpected failure in non-transactional index creation:', err);
    } finally {
      client.release();
    }

    console.log(`  -> Executed successfully without transaction wrapper: ${success}`);
    console.log(`  -> Index validated in pg_catalog (indisvalid = true): ${indexValidInCatalog}`);

    if (success && indexValidInCatalog) {
      console.log('  PASS: CREATE INDEX CONCURRENTLY succeeded cleanly and created valid index in non-transactional mode.\n');
    } else {
      console.error('  FAIL: Non-transactional index creation failed or was invalid in catalog!');
      allPassed = false;
    }
  }

  // --------------------------------------------------------------------------
  // TEST CASE 4: SafeMigrate CLI Static Analysis of SM005
  // --------------------------------------------------------------------------
  console.log('[Test Case 4] SafeMigrate CLI SM005 Static Detection & Mode Differentiation...');
  {
    const safemigrateBin = '/home/pr6thv3/flashcart_safemigrate_workspace/safemigrate/.venv/bin/safemigrate';
    const tempFixtureDir = path.resolve(process.cwd(), 'tests/fixtures_temp');
    if (!fs.existsSync(tempFixtureDir)) fs.mkdirSync(tempFixtureDir, { recursive: true });

    const fixturePath = path.join(tempFixtureDir, 'concurrent_index_migration.sql');
    fs.writeFileSync(
      fixturePath,
      `-- Test migration adding concurrent index
CREATE INDEX CONCURRENTLY idx_customer_email ON users (email);
`
    );

    // Subtest 4A: Wrapped mode -> MUST trigger SM005 and exit code 1
    let wrappedExitCode = 0;
    let wrappedOutput = '';
    try {
      wrappedOutput = execSync(
        `"${safemigrateBin}" scan "${fixturePath}" --migration-transaction-mode wrapped --fail-on high --format json`,
        { encoding: 'utf8' }
      );
    } catch (err: any) {
      wrappedExitCode = err.status;
      wrappedOutput = err.stdout?.toString() || '';
    }

    let wrappedJson: any = null;
    try {
      wrappedJson = JSON.parse(wrappedOutput);
    } catch {}

    const hasSM005InWrapped = wrappedJson?.findings?.some((f: any) => f.rule_id === 'SM005');
    console.log(`  -> [Wrapped Mode] Exit Code: ${wrappedExitCode} (expected 1)`);
    console.log(`  -> [Wrapped Mode] Triggered SM005: ${hasSM005InWrapped}`);
    if (hasSM005InWrapped) {
      const sm005 = wrappedJson.findings.find((f: any) => f.rule_id === 'SM005');
      console.log(`     Finding details: [${sm005.rule_id}] Severity: ${sm005.severity}, Message: ${sm005.message}`);
    }

    // Subtest 4B: Not_wrapped mode -> MUST NOT trigger SM005 and exit code 0
    let notWrappedExitCode = 0;
    let notWrappedOutput = '';
    try {
      notWrappedOutput = execSync(
        `"${safemigrateBin}" scan "${fixturePath}" --migration-transaction-mode not_wrapped --fail-on high --format json`,
        { encoding: 'utf8' }
      );
    } catch (err: any) {
      notWrappedExitCode = err.status;
      notWrappedOutput = err.stdout?.toString() || '';
    }

    let notWrappedJson: any = null;
    try {
      notWrappedJson = JSON.parse(notWrappedOutput);
    } catch {}

    const hasSM005InNotWrapped = notWrappedJson?.findings?.some((f: any) => f.rule_id === 'SM005');
    console.log(`  -> [Not Wrapped Mode] Exit Code: ${notWrappedExitCode} (expected 0)`);
    console.log(`  -> [Not Wrapped Mode] Triggered SM005: ${hasSM005InNotWrapped}`);

    // Cleanup temp fixture
    fs.rmSync(tempFixtureDir, { recursive: true, force: true });

    if (wrappedExitCode === 1 && hasSM005InWrapped && notWrappedExitCode === 0 && !hasSM005InNotWrapped) {
      console.log('  PASS: SafeMigrate accurately flags SM005 in wrapped mode and suppresses it in not_wrapped mode.\n');
    } else {
      console.error('  FAIL: SafeMigrate SM005 detection behavior did not match specification!');
      allPassed = false;
    }
  }

  // Clean up test table
  await query('DROP TABLE IF EXISTS sm005_test_table CASCADE');

  console.log('================================================================');
  console.log(`SM005 VERIFICATION VERDICT: ${allPassed ? 'ALL TESTS PASSED (APPROVED)' : 'TESTS FAILED (REQUEST CHANGES)'}`);
  console.log('================================================================\n');

  return allPassed;
}

runSM005Verification()
  .then((passed) => {
    if (!passed) process.exit(1);
  })
  .catch((err) => {
    console.error('FATAL SM005 ERROR:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
