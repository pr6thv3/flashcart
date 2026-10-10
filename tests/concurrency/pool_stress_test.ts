import { pool, query, withTransaction, checkHealth, closePool } from '../../src/db/pool.js';

interface StressTestResult {
  testName: string;
  totalRequests: number;
  successful: number;
  failed: number;
  elapsedMs: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  p95LatencyMs: number;
  poolTotalCount: number;
  poolIdleCount: number;
  poolWaitingCount: number;
}

function calculateP95(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

async function runPoolStressTests(): Promise<boolean> {
  console.log('================================================================');
  console.log('FLASHCART ADVERSARIAL STRESS TEST: CONNECTION POOL CONCURRENCY');
  console.log('================================================================\n');

  let allPassed = true;

  // Verify initial health
  const initialHealth = await checkHealth();
  console.log(`[Baseline] PostgreSQL Health: ${initialHealth.status} (latency: ${initialHealth.latencyMs}ms)`);
  console.log(`[Baseline] Pool max configured: ${(pool as any).options.max || 20}`);
  console.log(`[Baseline] Pool stats -> total: ${pool.totalCount}, idle: ${pool.idleCount}, waiting: ${pool.waitingCount}\n`);

  if (initialHealth.status !== 'healthy') {
    throw new Error(`Initial health check failed: ${initialHealth.error}`);
  }

  // --------------------------------------------------------------------------
  // TEST 1: 100 Concurrent Queued Queries (Exceeding Pool Max of 20 by 5x)
  // --------------------------------------------------------------------------
  console.log('[Test 1] 100 Concurrent Queued Queries (5x Pool Max)...');
  {
    const concurrency = 100;
    const latencies: number[] = [];
    let successful = 0;
    let failed = 0;
    const startTime = Date.now();

    const tasks = Array.from({ length: concurrency }, async (_, i) => {
      const qStart = Date.now();
      try {
        const res = await query('SELECT $1::int AS worker_id, pg_sleep(0.01)', [i]);
        const lat = Date.now() - qStart;
        latencies.push(lat);
        if (res.rows[0].worker_id === i) {
          successful++;
        } else {
          failed++;
        }
      } catch (err: any) {
        failed++;
        console.error(`  Worker ${i} failed:`, err.message);
      }
    });

    await Promise.all(tasks);
    const elapsedMs = Date.now() - startTime;
    const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatencyMs = Math.max(...latencies);
    const p95LatencyMs = calculateP95(latencies);

    console.log(`  -> Completed ${concurrency} queries in ${elapsedMs}ms`);
    console.log(`  -> Successful: ${successful}/${concurrency}, Failed: ${failed}`);
    console.log(`  -> Avg Latency: ${avgLatencyMs.toFixed(1)}ms | P95: ${p95LatencyMs}ms | Max: ${maxLatencyMs}ms`);
    console.log(`  -> Pool stats -> total: ${pool.totalCount}, idle: ${pool.idleCount}, waiting: ${pool.waitingCount}`);

    if (successful !== concurrency || failed !== 0) {
      console.error('  FAIL: Some concurrent queries failed!');
      allPassed = false;
    } else if (pool.waitingCount !== 0) {
      console.error('  FAIL: Pool has pending waiting requests after completion!');
      allPassed = false;
    } else {
      console.log('  PASS: Pool queuing handled 5x concurrency seamlessly with 100% success.\n');
    }
  }

  // --------------------------------------------------------------------------
  // TEST 2: 50 Concurrent Transactions with Database Writes
  // --------------------------------------------------------------------------
  console.log('[Test 2] 50 Concurrent Transactions with Atomic DB Inserts...');
  {
    const concurrency = 50;
    const latencies: number[] = [];
    let successful = 0;
    let failed = 0;
    const startTime = Date.now();

    // Use audit_log table to insert concurrent records
    const testBatchId = `stress_batch_${Date.now()}`;

    const tasks = Array.from({ length: concurrency }, async (_, i) => {
      const tStart = Date.now();
      try {
        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, changes)
             VALUES (gen_random_uuid(), NULL, 'STRESS_TEST', 'pool_test', $1, $2::jsonb)`,
            [`worker_${i}`, JSON.stringify({ batch: testBatchId, workerIndex: i })]
          );
        });
        const lat = Date.now() - tStart;
        latencies.push(lat);
        successful++;
      } catch (err: any) {
        failed++;
        console.error(`  Transaction worker ${i} failed:`, err.message);
      }
    });

    await Promise.all(tasks);
    const elapsedMs = Date.now() - startTime;
    const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p95LatencyMs = calculateP95(latencies);

    // Verify written count in database
    const verifyRes = await query(
      "SELECT count(*)::int AS cnt FROM audit_log WHERE changes->>'batch' = $1",
      [testBatchId]
    );
    const countInDb = verifyRes.rows[0].cnt;

    console.log(`  -> Completed ${concurrency} transactions in ${elapsedMs}ms`);
    console.log(`  -> Successful: ${successful}/${concurrency}, DB row count: ${countInDb}`);
    console.log(`  -> Avg Latency: ${avgLatencyMs.toFixed(1)}ms | P95: ${p95LatencyMs}ms`);
    console.log(`  -> Pool stats -> total: ${pool.totalCount}, idle: ${pool.idleCount}, waiting: ${pool.waitingCount}`);

    // Cleanup
    await query("DELETE FROM audit_log WHERE changes->>'batch' = $1", [testBatchId]);

    if (successful !== concurrency || countInDb !== concurrency) {
      console.error(`  FAIL: Transaction count mismatch: expected ${concurrency}, found ${countInDb}`);
      allPassed = false;
    } else {
      console.log('  PASS: 50 concurrent transactions completed atomically with zero loss or deadlocks.\n');
    }
  }

  // --------------------------------------------------------------------------
  // TEST 3: Burst Stress Test — 200 Concurrent Fast Queries
  // --------------------------------------------------------------------------
  console.log('[Test 3] Burst Stress Test — 200 Concurrent Fast Queries...');
  {
    const concurrency = 200;
    const latencies: number[] = [];
    let successful = 0;
    let failed = 0;
    const startTime = Date.now();

    const tasks = Array.from({ length: concurrency }, async (_, i) => {
      const qStart = Date.now();
      try {
        const res = await query('SELECT 1 AS num');
        latencies.push(Date.now() - qStart);
        if (res.rows[0].num === 1) {
          successful++;
        } else {
          failed++;
        }
      } catch (err: any) {
        failed++;
        console.error(`  Burst worker ${i} failed:`, err.message);
      }
    });

    await Promise.all(tasks);
    const elapsedMs = Date.now() - startTime;
    const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const p95LatencyMs = calculateP95(latencies);

    console.log(`  -> Executed ${concurrency} burst queries in ${elapsedMs}ms`);
    console.log(`  -> Throughput: ${(concurrency / (elapsedMs / 1000)).toFixed(1)} queries/sec`);
    console.log(`  -> Successful: ${successful}/${concurrency}, Failed: ${failed}`);
    console.log(`  -> Avg Latency: ${avgLatencyMs.toFixed(1)}ms | P95: ${p95LatencyMs}ms`);
    console.log(`  -> Pool stats -> total: ${pool.totalCount}, idle: ${pool.idleCount}, waiting: ${pool.waitingCount}`);

    if (successful !== concurrency || failed !== 0) {
      console.error('  FAIL: Burst test had failures!');
      allPassed = false;
    } else {
      console.log('  PASS: Burst test completed with 100% success and high throughput.\n');
    }
  }

  // --------------------------------------------------------------------------
  // TEST 4: Error Isolation & Connection Leak Prevention under Concurrency
  // --------------------------------------------------------------------------
  console.log('[Test 4] Error Resilience: 60 Concurrent Queries (30 Valid + 30 Intentional Errors)...');
  {
    const concurrency = 60;
    let validSuccess = 0;
    let expectedErrorsCaught = 0;
    let unexpectedFailures = 0;
    const initialTotalCount = pool.totalCount;

    const tasks = Array.from({ length: concurrency }, async (_, i) => {
      const isFailing = i % 2 === 0;
      if (isFailing) {
        // Intentionally execute invalid SQL causing database error
        try {
          await query('SELECT 100 / 0 AS divide_by_zero');
          unexpectedFailures++;
        } catch (err: any) {
          if (err.code === '22012') { // division_by_zero
            expectedErrorsCaught++;
          } else {
            console.error(`  Worker ${i} got unexpected error:`, err);
            unexpectedFailures++;
          }
        }
      } else {
        // Valid query
        try {
          const res = await query('SELECT $1::int AS val', [i]);
          if (res.rows[0].val === i) {
            validSuccess++;
          } else {
            unexpectedFailures++;
          }
        } catch (err: any) {
          console.error(`  Worker ${i} failed unexpectedly:`, err);
          unexpectedFailures++;
        }
      }
    });

    await Promise.all(tasks);

    console.log(`  -> Valid queries succeeded: ${validSuccess}/30`);
    console.log(`  -> Expected division-by-zero errors caught: ${expectedErrorsCaught}/30`);
    console.log(`  -> Unexpected failures: ${unexpectedFailures}`);
    console.log(`  -> Pool stats after errors -> total: ${pool.totalCount}, idle: ${pool.idleCount}, waiting: ${pool.waitingCount}`);

    // Allow any pending cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Confirm that connections are not leaked or stuck waiting
    if (pool.waitingCount !== 0) {
      console.error('  FAIL: Pool has orphaned waiting callers after errors!');
      allPassed = false;
    } else if (validSuccess !== 30 || expectedErrorsCaught !== 30 || unexpectedFailures !== 0) {
      console.error('  FAIL: Error resilience test failed to isolate errors cleanly!');
      allPassed = false;
    } else {
      console.log('  PASS: Errors cleanly isolated without leaking connections or corrupting the pool.\n');
    }
  }

  // --------------------------------------------------------------------------
  // TEST 5: Post-Stress Pool Health Check
  // --------------------------------------------------------------------------
  console.log('[Test 5] Post-Stress Pool Health & Resource Cleanliness...');
  {
    const postHealth = await checkHealth();
    console.log(`  -> PostgreSQL Post-Stress Health: ${postHealth.status} (latency: ${postHealth.latencyMs}ms)`);
    console.log(`  -> Pool final stats -> total: ${pool.totalCount}, idle: ${pool.idleCount}, waiting: ${pool.waitingCount}`);

    if (postHealth.status !== 'healthy') {
      console.error(`  FAIL: Database unhealthy after stress test: ${postHealth.error}`);
      allPassed = false;
    } else if (pool.waitingCount > 0) {
      console.error(`  FAIL: Pool waitingCount is ${pool.waitingCount} (expected 0)`);
      allPassed = false;
    } else {
      console.log('  PASS: Pool is completely healthy and cleanly drained.\n');
    }
  }

  console.log('================================================================');
  console.log(`STRESS TEST VERDICT: ${allPassed ? 'ALL TESTS PASSED (APPROVED)' : 'TESTS FAILED (REQUEST CHANGES)'}`);
  console.log('================================================================\n');

  return allPassed;
}

runPoolStressTests()
  .then((passed) => {
    if (!passed) process.exit(1);
  })
  .catch((err) => {
    console.error('FATAL STRESS TEST ERROR:', err);
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
