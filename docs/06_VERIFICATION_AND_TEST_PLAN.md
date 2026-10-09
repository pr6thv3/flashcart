# 06 — Verification, Test and Benchmark Plan

**Status:** Proposed baseline for sign-off  
**Principle:** Every important claim must map to an automated test, an observed experiment, or an explicit limitation.

## 1. Test layers

| Layer | Tooling direction | What it proves |
|---|---|---|
| Static checks | TypeScript compiler, ESLint/formatter, Python type/lint checks | Consistent, type-safe code and basic defects caught early |
| Unit | Vitest/Jest for TS; pytest for Python | Domain functions, validators, state transitions, analyzer rules |
| Database integration | Disposable PostgreSQL containers matching supported major | Real SQL, constraints, migrations, locks, webhook/idempotency effects |
| API integration | HTTP tests against API + test database | Authentication, authorization, contract and error behavior |
| Browser end-to-end | Playwright | Customer/vendor/admin critical journeys on a real deployed-like web/API setup |
| Concurrency/load | k6 plus direct database assertions | Inventory/checkout invariant under simultaneous requests and measured performance |
| Migration compatibility | node-pg-migrate + old/new app contract scenarios | Apply/upgrade paths and rolling-deployment compatibility assumptions |
| SafeMigrate regression | pytest fixtures, JSON/SARIF schema checks, labeled corpus | Rule precision/coverage, deterministic reports and CLI policy outcomes |
| Security | Dependency scanning, secret scanning, targeted abuse tests and later independent review | Known attack paths tested and dependency risk visible |
| Operational recovery | Restore drill, restart/failure simulations, stuck-job reconciliation | Service can recover from documented failure cases |

## 2. FlashCart invariants to assert directly

Automated tests should inspect the database, not only HTTP response messages.

- `on_hand_qty >= 0` and `reserved_qty >= 0`.
- `reserved_qty <= on_hand_qty` under the chosen semantics.
- For each flash sale, `quantity_sold + quantity_reserved <= quantity_limit`.
- One idempotency key maps to one checkout operation/request fingerprint.
- One provider event ID is processed at most once for each provider.
- A payment can only finalize a checkout/orders once.
- A reservation is consumed or released at most once.
- Vendor-owned writes cannot cross vendor boundaries.
- Historical order item price/title snapshots do not change when a product is edited.
- Paid, failed, expired, cancelled and refunded states follow allowed transitions only.

## 3. Concurrency test: flash-sale inventory

### Scenario

- Create a published flash-sale product with 10 eligible sale units and sufficient overall inventory.
- Start 200 simultaneous checkout attempts, each requesting one unit, through the actual API/check-out service.
- Ensure requests contend in a controlled start window; save load tool config, commit SHA, seed ID, environment and timestamps.
- Let the test run through the intended reservation phase, and separately test payment success/expiry so “reserved” is not confused with “sold.”

### Assertions

1. No more than 10 units are reserved/sold against the sale cap at any time.
2. No negative stock or inconsistent sale counters exist after all operations settle.
3. With all requests distinct and one-unit demand, the reservation race admits no more than 10 valid reservations; when the test's setup guarantees no competing actor and reservations stay alive, exactly 10 should be admitted.
4. The remaining requests receive the documented conflict/sold-out result; unexpected 500s fail the test.
5. Duplicate retries of a winning request do not produce a second reservation/order.
6. Cancelled/expired/failed attempts release reservations once; confirmed attempts consume reservations once.
7. Query/assertion output includes requested attempts, accepted reservations, successful payments if simulated, sold-out/conflict responses, unexpected errors, final stock and sale counters.

### Repeatability

Run several times with fixed fixture setup and fresh DB state. Record any nondeterminism. Avoid relying on an arbitrary sleep to claim the final state has settled; wait for a defined state/event condition with a timeout.

## 4. Payment and order recovery matrix

| Fault/test | Expected behavior |
|---|---|
| Provider returns success normally | Verified confirmation transitions checkout/orders once |
| Provider returns decline/failure | Failure recorded; reservation released according to policy |
| Provider request times out before response | Checkout remains reconcilable; lookup/idempotency used before another charge attempt |
| Provider succeeds but browser closes | Webhook/reconciliation still finalizes the checkout |
| Same webhook delivered multiple times | Same final state; one set of side effects |
| Webhook has invalid signature | Rejected and security event recorded without processing |
| Events arrive out of order | State machine prevents invalid regression; reconcile with provider if needed |
| Payment succeeds after reservation expiry | Fresh reservation attempt or compensating void/refund path; no oversell |
| Refund request times out | Stable refund identity and provider lookup/reconciliation avoid duplicate refund |
| Worker stops after job claim | Lease/claim expiry allows safe recovery; job is idempotent |

Use a provider sandbox and a deterministic fake provider in tests. A test double verifies our retry logic but does not substitute for the real provider's sandbox behavior.

## 5. Security/authorization suite

- Customer A versus Customer B data access tests for cart, addresses, checkout and orders.
- Vendor A versus Vendor B product, inventory, sale, order and fulfillment mutation tests.
- Attempted role escalation and unapproved vendor publishing.
- SQL injection attempts against parameters, filters and sort values.
- CSRF and origin checks for cookie-authenticated writes.
- Session expiration/revocation, reset token replay/expiry and password-reset enumeration resistance.
- Rate-limit tests on login/reset, checkout and sensitive admin actions.
- Payment webhook signature, replay and duplicate-event tests.
- Image upload MIME/extension/size/object ownership tests.
- Secret scan and log redaction assertions.

## 6. SafeMigrate rule test standard

For every rule, include:

1. Minimal positive SQL fixture expected to trigger.
2. Semantically similar negative fixture expected not to trigger.
3. Multi-statement/file context fixture.
4. Applicable PostgreSQL-version case(s).
5. Unknown/context-missing case that should lower confidence or explain uncertainty.
6. Expected rule ID, severity, confidence, source location and rationale fields.
7. JSON/SARIF serialization fixture and deterministic output assertion.
8. CLI threshold/exit-code assertion.

Use a labeled corpus. Track recall/precision only over that corpus and clearly state its size and limits. A rule that cannot distinguish a risky pattern from a valid near-miss must be revised or emitted with lower confidence/advisory semantics.

## 7. SafeMigrate ↔ FlashCart integration tests

Maintain in FlashCart:

- `tests/migrations/safe/` with representative safe/compatible migration examples.
- `tests/migrations/risky/` with intentionally risky examples that must trigger documented rules.
- CI scripts that run SafeMigrate in a pinned version.
- Expected outcome manifests per fixture, including the allowed policy result.

Required pipeline tests:

- Risky fixture PR produces the expected finding and blocks only when it crosses the configured enforcement policy.
- Compatible additive fixture passes the enforced threshold while retaining any appropriate low/info finding.
- Unparseable or unsupported migration is not silently treated as safe.
- SARIF/JSON artifact is uploaded and available after the run.
- SafeMigrate version and configuration are included in the report.
- CI failure distinguishes “policy failure” from “analyzer crashed/failed to parse.”

## 8. Migration safety tests

- Build schema from empty DB.
- Upgrade previous release schema to current schema using representative existing data.
- Verify constraints and application behavior before and after migration.
- Test old-app/new-schema compatibility for migrations used in a rolling deploy.
- For staged backfills, test bounded batches, restart/resume, metrics, rate limiting and completion verification.
- Test index creation in the actual runner transaction configuration; explicitly cover concurrent index restrictions.
- Review data-loss migrations with a restore or forward-fix plan; do not assume every down migration is safe.
- Run SafeMigrate against every committed migration and record the tool version/report.

## 9. Performance and capacity tests

Performance is measured on a declared environment, not inferred from a request count alone.

### Initial performance gates (targets to validate in staging, adjustable only with evidence)

- Public catalog APIs: target p95 under 500 ms for the documented baseline dataset/load.
- Non-provider API writes: target p95 under 800 ms for the documented baseline dataset/load.
- Checkout API time is reported separately from provider payment completion latency.
- No unexpected 5xx under the declared baseline scenario; designed sold-out conflicts and validation errors are counted separately.
- No invariant violation under concurrent load.

The exact dataset, instance sizes, region, connection pool size, request mix, cache state, test duration, warm-up, tool version and commit SHA must accompany every performance report. Do not claim 1,000 requests/second or production-scale readiness until the test runs on the intended deployment topology and its limits are documented.

### Benchmark progression

1. Local correctness and 200 concurrent one-unit flash-sale attempts.
2. Staging mixed workload (browse/cart/checkout) at gradually increasing concurrency.
3. Identify bottleneck through CPU, DB waits, slow queries, pool saturation, provider latency and p95/p99.
4. Apply one measured optimization at a time; run same scenario before and after.
5. Add cache/read replica/partitioning only when benchmark evidence supports it.

## 10. CI required checks

- Install dependencies from lockfiles.
- Lint/type-check/build web and API.
- Unit tests and SafeMigrate pytest suite.
- Start disposable PostgreSQL; apply migrations; run integration tests.
- Run required rule scan over changed migrations (advisory during calibration, enforced after rule acceptance).
- Run a smaller browser smoke suite on pull requests; full load/security/recovery tests on appropriate schedule/release branch.
- Publish test and SafeMigrate artifacts with commit SHA and configuration.
- Protect release branch from merges when required checks fail.

## 11. Evidence format

Each verification artifact should state: claim tested, test ID, command/config, environment, timestamp, commit SHA, expected result, actual result, pass/fail, log/report path and limitations. Screenshots are illustrative; logs and assertions are the primary evidence.
