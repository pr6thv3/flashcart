# Evidence Demonstrations & Verification Global Index

**Project:** FlashCart Multi-Vendor Marketplace & SafeMigrate Static Migration Risk Analyzer  
**Requirement Reference:** ORIGINAL_REQUEST.md §R4, Document 08 (Integration & Proof Presentation), Milestone M5  
**Baseline Commits:**
- FlashCart: `eb53847` (`pr6thv3/flashcart`)
- SafeMigrate: `cc464fa` (`pr6thv3/safemigrate`)  
**Execution Environment:**
- Operating System: Linux x86_64 (Fedora/RHEL kernel)
- Runtime: Node.js v26.8.1 (TypeScript 5.7.2), Python 3.14.7 (SQLGlot 25.0+)
- Database: PostgreSQL 17 (Docker Compose container `flashcart-postgres`, port 5432)
- CI Workflows: GitHub Actions (`.github/workflows/ci.yml`, `.github/workflows/safemigrate-gate.yml`)

---

## Executive Summary

Milestone M5 establishes empirical, reproducible proof across all four demonstrations specified in Document 08. Each demonstration was executed against the real runtime environment (PostgreSQL 17 docker container, live Express API routes, genuine SQLGlot AST analysis engine), producing verifiable logs, manifests, sanitized database dumps, and SARIF/JSON reports.

| Demo | Title | Primary Claim Verified | Observed Exit Code / Status | Primary Artifacts |
|:---:|---|---|:---:|---|
| **Demo 1** | Marketplace Workflow | End-to-end customer journey, multi-vendor cart with authoritative server revalidation, split sub-orders (`UNIQUE(checkout_id, vendor_id)`), decoupled sandbox payment, and zero-IDOR vendor fulfillment isolation. | **PASSED** (HTTP 200/201 across all steps) | `demo_1_console.log`<br>`sanitized_database_records.json`<br>`demonstration_manifest.json` |
| **Demo 2** | Flash Sale 200-Concurrency Proof | 10 flash-sale units subjected to 200 simultaneous 1-unit checkout requests across 200 distinct buyer users: exactly 10 accepted reservations (HTTP 201), 190 clean rejections (HTTP 409 `INVENTORY_UNAVAILABLE`), 0 5xx errors, zero negative stock, followed by decoupled payment decrementing warehouse inventory from 100 to 90. | **PASSED** (10 accepted, 190 conflicts, 0 server errors) | `demo_2_console.log`<br>`db_verification.json`<br>`demonstration_manifest.json` |
| **Demo 3** | SafeMigrate Detection Proof | Pure static AST analysis of risky migration fixture (`drop_description.sql`) without live database connections; detects rule `SM002` (DROP COLUMN) with High severity and High confidence, exits with code 1 under `--fail-on high`, and emits OASIS SARIF 2.1.0 & JSON v1.0. | **EXIT CODE 1** (Policy threshold breached) | `demo_3_console.log`<br>`demo_3_output.json`<br>`demo_3_output.sarif` |
| **Demo 4** | CI PR Gate Integration Proof | Pinned SafeMigrate CLI in CI gate: PR #101 (destructive column drop) fails policy and blocks PR merge (Exit 1); PR #102 (backward-compatible additive column) passes policy and permits merge (Exit 0). | **PR 1: EXIT 1 (BLOCKED)**<br>**PR 2: EXIT 0 (PASSED)** | `pr1_risky_report.sarif`<br>`pr2_additive_report.sarif`<br>`demonstration_manifest.json` |

---

## Demonstration 1: Multi-Vendor Marketplace Workflow

- **Specification Reference:** Document 08 §Demo 1, `flashcart/issues/issue_07_evidence_demo_1_marketplace_workflow.md`
- **Automated Runner:** `flashcart/tests/demonstrations/demo_1_marketplace_flow.ts`
- **Execution Command:**
  ```bash
  cd flashcart
  npx tsx tests/demonstrations/demo_1_marketplace_flow.ts
  ```
- **Evidence Directory:** `flashcart/docs/evidence/demo_1_marketplace_workflow/`
- **Key Empirical Verifications:**
  1. **Customer Lifecycle:** New buyer signs up via `POST /api/v1/auth/register` (HTTP 201), authenticates via `POST /api/v1/auth/login` (HTTP 200), and browses public catalog via `GET /api/v1/products`.
  2. **Authoritative Cart Revalidation:** Buyer adds 2x Product 1 (Vendor 1, ₹45.00 each) and 1x Product 2 (Vendor 2, ₹22.00 each) via `POST /api/v1/cart/items`. Server authoritative subtotal is strictly recomputed as ₹112.00 (11200 minor units). Client values are never trusted.
  3. **Atomic Reservation & Order Splitting:** Buyer submits checkout reservation via `POST /api/v1/checkout/reserve` with `Idempotency-Key`. The system atomically creates parent checkout and exactly 2 vendor sub-orders in `orders` enforcing PostgreSQL database constraint `UNIQUE(checkout_id, vendor_id)`.
  4. **Decoupled Sandbox Payment:** Payment is completed via `POST /api/v1/checkout/pay` with `{ paymentMethod: 'sandbox', simulateStatus: 'success' }`. Checkout and both sub-orders transition to `paid`; warehouse stock decrements from 50->48 and 30->29.
  5. **Vendor Portal Tenant Isolation (Zero-IDOR):** Vendor 1 logs in and queries `GET /api/v1/vendor/orders`: sees exclusively Vendor 1's sub-order; Vendor 2's sub-order is hidden. Vendor 1 attempts unauthorized fulfillment of Vendor 2's order via `PUT /api/v1/vendor/orders/:id/fulfill` and receives clean HTTP 404 (`NotFoundError`).
  6. **Fulfillment State Machine:** Vendor 1 fulfills Vendor 1's sub-order (status transitions from `paid` -> `shipped`), while Vendor 2's sub-order remains completely untouched in status `paid`.
  7. **Sanitized Database Export:** Complete audit trail dumped from `checkouts`, `orders`, `order_items`, `payment_attempts`, and `inventory_reservations` with password hashes, session tokens, and secrets redacted in `sanitized_database_records.json`.

---

## Demonstration 2: Flash Sale 200-Concurrency Proof

- **Specification Reference:** Document 08 §Demo 2, `flashcart/issues/issue_08_evidence_demo_2_200_concurrency_proof.md`
- **Automated Runner:** `flashcart/tests/concurrency/flash_sale_200_concurrency.ts`
- **Execution Command:**
  ```bash
  cd flashcart
  npx tsx tests/concurrency/flash_sale_200_concurrency.ts
  ```
- **Evidence Directory:** `flashcart/docs/evidence/demo_2_flash_sale_concurrency/`
- **Contention Benchmark Metrics:**
  - **Total Concurrent Requests:** 200 simultaneous HTTP requests
  - **Distinct Buyer Identities:** 200 distinct seeded accounts with unique JWT session tokens
  - **Flash Sale Stock Cap:** 10 units (`quantity_limit = 10`)
  - **Physical Initial Warehouse Stock:** 100 units
  - **Accepted Reservations (HTTP 201):** Exactly 10
  - **Rejected Conflicts (HTTP 409 `INVENTORY_UNAVAILABLE`):** Exactly 190
  - **Unhandled Server Errors (HTTP 5xx):** 0
  - **Latency:** Min: 226ms, Avg: 673ms, P95: 986ms, Max: 1011ms (Total Elapsed: 1021ms)
- **Two-Phase Inventory Invariant Verification:**
  - **Part A (Reservation State):** Flash sale `quantity_reserved = 10`, `quantity_sold = 0`; Inventory `on_hand_qty = 100`, `reserved_qty = 10`.
  - **Part B (Settled Payment State):** Decoupled sandbox payments executed for all 10 winners; Flash sale `quantity_reserved = 0`, `quantity_sold = 10`; Inventory `on_hand_qty = 90`, `reserved_qty = 0`.
  - **Zero Overselling Guarantee:** Neither table check constraint (`chk_inventory_non_negative`, `chk_flash_sales_limits`) was violated. 0 negative stock, 0 orphaned reservations.

---

## Demonstration 3: SafeMigrate Detection Proof

- **Specification Reference:** Document 08 §Demo 3, `safemigrate/issues/issue_05_evidence_demo_3_risky_migration_detection.md`
- **Execution Command:**
  ```bash
  cd safemigrate
  .venv/bin/safemigrate scan docs/evidence/demo_3_detection_proof/fixtures/drop_description.sql \
    --fail-on high \
    --format human
  ```
- **Evidence Directory:** `safemigrate/docs/evidence/demo_3_detection_proof/`
- **Key Empirical Verifications:**
  1. **Zero Database Connections:** Pure static AST analysis powered by SQLGlot PostgreSQL parser.
  2. **Rule Detection:** Accurately flags `SM002: Destructive Column Drop` on `ALTER TABLE products DROP COLUMN description;`.
  3. **Diagnostic Metadata:** Severity: `high`, Confidence: `high`, Location: Line 3 Column 5.
  4. **Remediation Rationale:** Explicitly explains data destruction risk in rolling deployments and recommends the expand-contract deprecation pattern.
  5. **Deterministic Exit Code:** Exits with code `1` (Policy threshold breached).
  6. **Dual Formatter Artifacts:** Emits conforming JSON v1.0 (`demo_3_output.json`) and OASIS SARIF 2.1.0 (`demo_3_output.sarif`).

---

## Demonstration 4: CI PR Gate Integration Proof

- **Specification Reference:** Document 08 §Demo 4, `safemigrate/issues/issue_06_evidence_demo_4_ci_pr_gate_integration.md`
- **Automated Runner:** `flashcart/tests/demonstrations/demo_4_ci_simulation.sh`
- **Execution Command:**
  ```bash
  cd flashcart
  ./tests/demonstrations/demo_4_ci_simulation.sh
  ```
- **Evidence Directories:**
  - `flashcart/docs/evidence/demo_4_ci_integration/`
  - `safemigrate/docs/evidence/demo_4_ci_integration/`
- **Dual Pull Request Verification:**
  - **PR #101 (Risky Migration):** Fixture contains `ALTER TABLE products DROP COLUMN description;`. SafeMigrate scan breaches policy threshold (`--fail-on high`), exits with code `1`, and marks CI gate `FAILED`, successfully blocking PR merge.
  - **PR #102 (Additive Migration):** Fixture contains `ALTER TABLE orders ADD COLUMN vendor_note TEXT;`. SafeMigrate scan detects 0 policy violations, exits with code `0`, and marks CI gate `PASSED`, permitting merge.
  - **Standardized Machine Output:** Both PR runs emit OASIS SARIF 2.1.0 reports (`pr1_risky_report.sarif`, `pr2_additive_report.sarif`) and JSON reports for automated CI annotations.

---

## Complete Test Suite Verification

All test suites and builds across both repositories pass 100%:

1. **FlashCart Vitest Test Suite:**
   ```bash
   cd flashcart && npm test
   # Result: 14 test files passed (14/14), 98 tests passed (98/98)
   ```
2. **SafeMigrate Pytest Test Suite:**
   ```bash
   cd safemigrate && .venv/bin/pytest
   # Result: 72 tests passed (72/72)
   ```
3. **FlashCart Web Next.js Build:**
   ```bash
   cd flashcart/web && npm run build
   # Result: 10/10 static/dynamic pages compiled successfully with zero type or lint errors
   ```

---

## Directory Index of Evidence Artifacts

```
flashcart/docs/evidence/
├── README.md                                # This unified index
├── demo_1_marketplace_workflow/
│   ├── demo_1_console.log                   # Full terminal execution log
│   ├── demonstration_manifest.json          # Run metadata, commit SHA, IDs
│   ├── sanitized_database_records.json      # Sanitized dump of checkouts, orders, items, payments
│   └── DEMO_1_SUMMARY.md                    # Detailed summary and assertion table
├── demo_2_flash_sale_concurrency/
│   ├── demo_2_console.log                   # 200-request concurrency execution log
│   ├── terminal_output.txt                  # Verbatim terminal output
│   ├── demonstration_manifest.json          # Metrics, latencies (P95), commit SHA
│   ├── db_verification.json                 # Pre/Part-A/Part-B relational database verification
│   └── DEMO_2_SUMMARY.md                    # Detailed summary and results table
└── demo_4_ci_integration/
    ├── fixtures/
    │   ├── pr1_risky_drop_description.sql
    │   └── pr2_additive_vendor_note.sql
    ├── pr1_risky_report.sarif               # SARIF 2.1.0 output for blocked PR 1
    ├── pr1_risky_report.json                # JSON v1.0 output for blocked PR 1
    ├── pr1_console.log                      # Console log showing exit code 1
    ├── pr2_additive_report.sarif            # SARIF 2.1.0 output for permitted PR 2
    ├── pr2_additive_report.json             # JSON v1.0 output for permitted PR 2
    ├── pr2_console.log                      # Console log showing exit code 0
    ├── demo_4_console.log                   # Full simulation runner console log
    ├── terminal_output.txt                  # Terminal output copy
    ├── demonstration_manifest.json          # Dual-PR verification manifest
    └── DEMO_4_SUMMARY.md                    # Detailed CI integration report

safemigrate/docs/evidence/
├── README.md                                # Mirrored unified index
├── demo_3_detection_proof/
    ├── fixtures/
    │   └── drop_description.sql
    ├── demo_3_output.json                   # JSON v1.0 finding report
    ├── demo_3_output.sarif                  # OASIS SARIF 2.1.0 report
    ├── demo_3_console.log                   # Terminal log with Rich formatted tables
    ├── report.json                          # Canonical JSON report
    ├── report.sarif                         # Canonical SARIF report
    ├── terminal_output.txt                  # Verbatim console output
    ├── demonstration_manifest.json          # Manifest with proof_verified: true
    └── DEMO_3_SUMMARY.md                    # Detailed detection proof summary
└── demo_4_ci_integration/                  # Mirrored artifacts from Demonstration 4
```
