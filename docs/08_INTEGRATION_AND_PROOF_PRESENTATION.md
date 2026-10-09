# 08 — SafeMigrate Integration, Evidence Plan and Proof Presentation

**Status:** Proposed presentation plan  
**Primary claim:** FlashCart is a functioning marketplace with tested transactional invariants; SafeMigrate independently analyzes its actual PostgreSQL migrations and produces actionable, reproducible findings enforced by CI.

## 1. What the proof must establish

The presentation is not just a website tour and not a terminal screenshot. We will prove separate claims with separately appropriate evidence.

| Claim | Primary evidence | What does not prove it by itself |
|---|---|---|
| FlashCart works end-to-end | Deployed/staging customer journey, API/database records, E2E test report | Static mockup or UI screenshot |
| Limited stock cannot be oversold in the tested scenario | Reproducible concurrent run + direct database invariants before/after | Animation of a stock counter or sequential manual purchases |
| Payment/order state is recoverable | Sandbox provider run, duplicate webhook/failure/timeout tests, state/event records | A green “payment successful” page alone |
| SafeMigrate detects a known risky pattern | Actual migration fixture, analyzer version/config, expected finding and CLI/JSON/SARIF output | A manually typed warning in a slide |
| SafeMigrate does not block every change indiscriminately | A compatible additive migration passes the configured policy; rule tests show near-misses | Showing only a single blocked migration |
| The tools work together | Actual FlashCart pull request/CI run using a pinned SafeMigrate version; pass/fail status and retained artifact | A diagram of two boxes with no CI run |
| Claims are reproducible | Repository commit SHA, exact commands/config, test artifacts and environment metadata | Results that cannot be rerun |

## 2. Integration design

- SafeMigrate remains a separate Python package/repository.
- FlashCart pins a tested SafeMigrate release (package version, container digest or versioned Action); no unpinned `main` branch in release CI.
- FlashCart's migration directory is scanned on pull requests that change migrations and on a scheduled full scan.
- During early rule calibration, use advisory mode: publish findings while tracking false positives and missing cases.
- Enforce a documented threshold only after the relevant rules have passed their own acceptance suite. Example policy: high/critical + high confidence blocks; medium confidence may require human review; parse/unsupported failure never silently passes as safe.
- Publish text summary and JSON/SARIF artifact with analyzer version, target PostgreSQL version, config fingerprint and repository commit.
- Pinning and output schema version make previous results reproducible.

## 3. Required demonstration fixtures

Keep demonstrative migration fixtures in a test-only location. Do not make the actual application's release migrations destructive just to produce a slide.

### Fixture A — known risky/destructive migration

Example intent: drop an existing `products.description` column, or another intentionally destructive operation against seeded test schema. The analyzer should identify the target and explain data loss/compatibility concerns. If enforced policy says high-confidence destructive operations require manual approval, the CI test PR must be blocked.

Use synthetic disposable data. Do not execute this fixture against production or use it as an automatic production migration.

### Fixture B — compatible additive migration

Example intent: add a nullable, backward-compatible field such as `vendor_note` to a test entity, while application code remains compatible. The migration is applied in disposable PostgreSQL and the app tests still pass. SafeMigrate must not invent a high-risk finding unsupported by the rule's assumptions; any low/info observation can remain visible.

### Fixture C — context/unsupported case

Provide a migration pattern for which table size, transaction wrapper, application compatibility or server version is unknown. SafeMigrate must say what it cannot determine and lower confidence/require review or report unsupported syntax, not fabricate facts or silently green-light an unanalyzed statement.

### Fixture D — migration-runner transaction mismatch

Use a test migration involving `CREATE INDEX CONCURRENTLY` with the actual configured runner mode. The integration test verifies whether the runner wraps the migration in a transaction and confirms the analyzer/validator behavior against the real configuration.

## 4. End-to-end proof script (approximately 12–15 minutes)

### Minute 0–1: State the thesis

Say: “FlashCart is the application that has real database changes and contested inventory. SafeMigrate is a separate tool that reviews those changes before merge. We will demonstrate the application invariant, the analyzer result, and the CI enforcement path using reproducible artifacts.”

Show repository links, release/commit SHAs and environment labels. State clearly whether the running site uses sandbox payments or a live approved provider.

### Minute 1–4: FlashCart real workflow

1. Open the deployed staging/pilot URL and show a real product/catalog page.
2. Log in as a seeded test customer; add a product and submit checkout.
3. Show the created checkout/order and its state in UI/API/database inspection with sensitive fields redacted.
4. Open the vendor view and demonstrate that the vendor can manage only its own item/order.
5. Show payment status from the configured sandbox or approved provider. Explicitly label sandbox behavior as test mode.

### Minute 4–7: Concurrency proof

1. Reset a disposable database to a known seed where sale limit is 10.
2. Show the exact load-test command/config and git SHA.
3. Launch 200 concurrent one-unit attempts, capturing responses and database invariants.
4. Display a result table: attempted, accepted reservations, sold-out conflicts, unexpected failures, final on-hand/reserved quantities, sale `quantity_reserved`/`quantity_sold`, and invariant violations.
5. Confirm no more than 10 units were reserved/sold against that sale and no inventory counter is negative. Wait for a deterministic terminal condition rather than declaring success before cleanup/payment simulation finishes.

The expected result is defined by the test setup: if there are 10 sale units, no competing actor and no unrelated constraints, at most 10 valid reservations should win; exactly 10 should be admitted when the setup guarantees ten valid requests can reserve. Report actual results, not a prewritten number if the run differs.

### Minute 7–10: SafeMigrate finding

1. Open the test-only risky migration in the FlashCart repository.
2. Run the pinned SafeMigrate CLI or show the CI run.
3. Show the rule ID, severity, confidence, line, rationale and suggested response.
4. Open the JSON/SARIF artifact; show the same finding is machine-readable and carries the analyzer version/config.
5. Show the configured CI policy result blocks this test change, if it meets the policy threshold.

### Minute 10–12: Safer case and uncertainty

1. Open the compatible additive fixture.
2. Run actual syntax/database tests and SafeMigrate on it.
3. Show that it passes the configured threshold while relevant observations remain visible.
4. Show one context-dependent/unsupported case and demonstrate an explicit uncertainty diagnostic instead of a false guarantee.

### Minute 12–15: Integration evidence and conclusion

Show the actual FlashCart PR check using the pinned SafeMigrate release, the expected failure and passing cases, test report, repository commit hashes and links to run artifacts. Close with measured scope and known limitations. Never represent staging/sandbox as a production real-money transaction.

## 5. Evidence bundle to retain

For each demonstration build/release, collect:

- Git commit SHA and tagged SafeMigrate version/container digest.
- Runtime/database versions and test environment description.
- Sanitized seed/setup instructions and exact command lines/config files.
- Concurrency load test raw results plus a summary table and direct DB invariant query output.
- Payment recovery test results (provider sandbox or test double clearly identified).
- Risky/safe/context migration fixture files and expected outcome manifests.
- SafeMigrate text/JSON/SARIF reports.
- GitHub Actions run URLs and PR check statuses.
- Unit/integration/E2E test summaries, build artifact identifiers and scan reports.
- Screenshots or short screen recording as visual support, not the only evidence.
- Known limitations and follow-up items.

Never include `.env`, payment secrets, session cookies, customer personal data, full production database exports or signed upload URLs in the evidence pack.

## 6. Results table template

| Experiment ID | Claim | Environment | Commit/version | Expected | Observed | Pass? | Artifact |
|---|---|---|---|---|---|---|---|
| `FC-CONC-001` | 10-unit sale cap under 200 concurrent attempts | Disposable PostgreSQL + test API | Fill from run | No cap/stock invariant violation | Fill from run | Fill | Load log + DB assertions |
| `FC-PAY-002` | Duplicate webhook is idempotent | Provider sandbox/test double | Fill from run | Single finalization | Fill from run | Fill | Webhook test report |
| `SM-RULE-001` | Destructive migration is reported | Local/CI | SafeMigrate version | Expected rule ID and severity | Fill from run | Fill | JSON/SARIF |
| `SM-SAFE-001` | Compatible additive migration passes threshold | Local/CI | SafeMigrate version | No unsupported high-confidence finding | Fill from run | Fill | CLI log + migration test |
| `SM-UNCERT-001` | Unknown context is not fabricated | Local/CI | SafeMigrate version | Explicit uncertainty | Fill from run | Fill | JSON report |
| `INT-CI-001` | FlashCart pull request enforces pinned tool | GitHub Actions | Both SHAs | Expected policy decision | Fill from run | Fill | Workflow run URL |

Do not fill the “Observed” cells until the tests have actually run. These are templates, not results.

## 7. How to present the two products as one proof story

Presentation structure:

1. **Problem:** schema changes and inventory races can cause data loss, broken deploys or overselling.
2. **FlashCart:** a real application where concurrent inventory, orders and payments exercise those database guarantees.
3. **SafeMigrate:** an independent analyzer for PostgreSQL migrations, with explicit rules, uncertainty and safer suggestions.
4. **Connection:** FlashCart's migration pull request invokes a pinned SafeMigrate release and retains a reproducible report.
5. **Proof:** test logs and DB assertions prove the checkout invariant; analyzer fixtures and integration tests prove expected detection; CI results prove the gate behaves as configured.
6. **Limits:** state tested versions, dataset and environment; clarify that static analysis is not a universal safety guarantee and performance claims are bounded by the actual benchmark.

Use separate repository READMEs and release tags, but link them to each other. FlashCart's README explains why SafeMigrate is in CI; SafeMigrate's README uses FlashCart as one real integration example without hard-coding the FlashCart name into analyzer logic.

## 8. Claims we may make only after evidence exists

- “The tested 10-unit flash-sale scenario did not oversell” only after a test artifact passes.
- “SafeMigrate detected this migration pattern” only for the shown rule, version and fixture context.
- “CI blocked the risky change” only after the actual check result is visible.
- “The site accepts real payments” only after provider approval and a verified live-mode end-to-end test; otherwise say sandbox/test mode.
- “Supports X requests per second” only after a repeatable load test documents environment, request mix, latency, error rate and correctness.
- “Safe migration” must be qualified as a finding/policy decision under known assumptions, never an absolute guarantee.

## 9. Presentation assets to create after implementation

- `docs/evidence/README.md` with index of proof artifacts.
- Short demo script with actual URLs and test account setup (no passwords in Git).
- Concurrency results chart generated from raw test output.
- SafeMigrate JSON/SARIF screenshots from actual run.
- Architecture diagram reflecting deployed reality, not planned future components.
- Release note listing tested versions and limitations.
- Optional 5–8 slide presentation: problem, architecture, FlashCart proof, SafeMigrate proof, integration/CI proof, measurements and limitations.
