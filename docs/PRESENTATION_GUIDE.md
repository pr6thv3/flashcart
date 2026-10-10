# Walkthrough — FlashCart & SafeMigrate: One Connected Engineering Story

> **Main Message:**  
> **FlashCart demonstrates the real database problems that occur in a multi-vendor marketplace. SafeMigrate is the independent tool we built to identify risky database changes before they enter the application's deployment pipeline.**

---

## 1. Presentation Plan — 10 Minutes

```
[0:00 - 1:00] Slide 1: The Problem (Flash sale overselling & destructive migrations)
     │
[1:00 - 2:00] Slide 2: The Architecture (FlashCart + PostgreSQL + SafeMigrate + CI Gate)
     │
[2:00 - 4:00] Live Demo 1: FlashCart Marketplace (Split orders, sandbox payment, tenant isolation)
     │
[4:00 - 6:00] Live Demo 2: Concurrency Proof (200 buyers vs 10 flash-sale units)
     │
[6:00 - 7:30] Live Demo 3: SafeMigrate CLI (Static SQL AST analysis on risky migrations)
     │
[7:30 - 9:00] Live Demo 4: CI Integration Gate (Dual-PR evaluation: Risky blocked, Additive passed)
     │
[9:00 - 10:00] Conclusion: Empirical Evidence, Automated Tests & Production Constraints
```

| Time | Duration | Segment | Core Focus | What Audience Observes |
|:---:|:---:|---|---|---|
| **0:00** | 1.0 min | **Slide 1 — The Problem** | Why concurrency breaks e-commerce inventory and why migrations break production. | Dual vulnerabilities: database race conditions causing negative stock, and unvalidated DDL locking tables or dropping active columns. |
| **1:00** | 1.0 min | **Slide 2 — The Architecture** | How FlashCart and SafeMigrate connect as one unified reliability engineering story. | System topology: PostgreSQL 17 source of truth, Express API, Next.js storefront, SafeMigrate AST risk analyzer, and GitHub Actions CI gate. |
| **2:00** | 2.0 min | **Live Demo 1 — FlashCart Storefront** | Multi-vendor ordering, server revalidation, and strict vendor tenant isolation. | Cart with 2 vendors, server recalculated totals, decoupled sandbox payment, and vendor portal rejecting unauthorized cross-tenant fulfillment (HTTP 404). |
| **4:00** | 2.0 min | **Live Demo 2 — Concurrency Proof** | 200 simultaneous checkout requests against a 10-unit flash sale limit. | Real-time terminal execution: exactly 10 accepted reservations (HTTP 201), 190 clean conflicts (HTTP 409), 0 server errors (HTTP 5xx), and database state proving 0 oversold. |
| **6:00** | 1.5 min | **Live Demo 3 — SafeMigrate CLI** | Pure static SQL AST risk analysis without database connection. | Scan of `drop_description.sql`: detected rule `SM002`, High severity, High confidence, SARIF 2.1.0/JSON output, and standardized Exit Code `1`. |
| **7:30** | 1.5 min | **Live Demo 4 — CI Integration Gate** | Automated pull-request policy gating before deployment. | Simulated CI runner: PR #101 (`DROP COLUMN`) blocked by Exit Code `1`; PR #102 (`ADD COLUMN`) allowed by Exit Code `0`. |
| **9:00** | 1.0 min | **Conclusion — Evidence & Limits** | Verifiable test proofs, SARIF reports, and engineering boundaries. | Vitest (99/99 passed), Pytest (72/72 passed), audit logs in `docs/evidence/`, and production launch prerequisites. |

---

## 2. What to Show on Screen

### First: FlashCart Running in the Browser (`http://localhost:3000`)

> [!TIP]
> **Presenter Mindset**: Do not start with files or source code. Show the working product immediately to ground the audience in the problem domain.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FlashCart Storefront                            │
├────────────────────────────────────────────────────────────────────────┤
│ [Flash Sale Banner: Cyber Headphones - 10 Units Left - Ends in 4h 12m] │
├────────────────────────────────────────────────────────────────────────┤
│ Vendor A (Apex Gear): Ergonomic Desk      ──┐                          │
│                                             ├─► Cart: 2 Vendors Added  │
│ Vendor B (Nova Sound): ANC Headphones     ──┘                          │
├────────────────────────────────────────────────────────────────────────┤
│ Checkout: Client tampering ignored ──► Server authoritative total      │
│ Decoupled Payment: Sandbox Gateway ──► Order split into 2 Sub-Orders   │
├────────────────────────────────────────────────────────────────────────┤
│ Vendor Portal (Apex): Sees only Order A | Accessing Order B ──► 404    │
└────────────────────────────────────────────────────────────────────────┘
```

#### Step-by-Step Screen Sequence:
1. **Browse Catalog & Active Flash Sales (`/`)**:
   - Open `http://localhost:3000`. Show the active flash sale banner: *Limited stock, real-time countdown timer*.
   - Point out that products belong to distinct vendors (e.g., **Apex Gear** and **Nova Sound**).
2. **Add Products from Two Vendors to Cart (`/cart`)**:
   - Add 1 item from Apex Gear (₹45.00) and 1 item from Nova Sound (₹22.00).
   - Open the cart. Explain: *"The browser displays the cart, but the client does not dictate the final financial transaction."*
3. **Checkout with Server-Enforced Price Revalidation (`/checkout`)**:
   - Show checkout initialization. Even if client-side state is altered, the server recalculates the exact prices from PostgreSQL inventory tables before holding stock.
4. **Complete Decoupled Sandbox Payment**:
   - Click **Pay with Sandbox Provider**.
   - Show the simulated webhook settlement: inventory transitions from `reserved` to `sold` without holding database locks open during external payment network latency.
   - Show the resulting orders page (`/orders`): the single parent checkout cleanly created **two isolated vendor sub-orders**.
5. **Switch to Vendor Portal (`/vendor`)**:
   - Log in as Vendor 1 (`apex@example.com` / `Password123!`).
   - The dashboard displays **only** Apex Gear's sub-order.
   - Attempt to inspect or fulfill Nova Sound's sub-order: server strictly rejects it with **HTTP 404 / 403 Forbidden**.

> **Key Talking Point:**  
> *"The frontend is only the interface. The backend and PostgreSQL enforce prices, stock, order creation, and vendor isolation."*

---

### Second: The 200-Buyer Flash-Sale Concurrency Test

> [!IMPORTANT]
> This is your strongest technical proof. It demonstrates a mathematically verifiable database invariant under extreme contention.

#### Reported Concurrency Test Results:

| Metric | Target Specification | Observed Result | Status |
|---|:---:|:---:|:---:|
| **Concurrent Buyers** | 200 distinct users | 200 distinct sessions | **VERIFIED** |
| **Available Flash Quota** | Exactly 10 units | 10 units | **VERIFIED** |
| **Accepted Reservations (HTTP 201)** | Exactly 10 | **10** | **100% Correct** |
| **Rejected Conflicts (HTTP 409)** | Exactly 190 | **190** | **Zero Overselling** |
| **Internal Server Errors (HTTP 5xx)** | Exactly 0 | **0** | **Zero Deadlocks** |
| **Oversold Units in PostgreSQL** | Exactly 0 | **0** | **Invariant Intact** |
| **PostgreSQL Stock State** | Physical: 90 / Sold: 10 | Physical: 90 / Sold: 10 | **Verified in DB** |

#### Terminal Commands to Execute Live:
```bash
# Run the automated 200-buyer concurrency stress test:
cd /home/pr6thv3/flashcart_safemigrate_workspace/flashcart
npx tsx tests/concurrency/flash_sale_200_concurrency.ts
```

#### Terminal Output Inspection:
Point out the live log stream:
- 200 concurrent HTTP requests firing in parallel across a ~948ms burst window.
- Exactly 10 requests receive `HTTP 201 Created` with unique `reservation_id` tokens.
- Exactly 190 requests receive `HTTP 409 Conflict` (`INVENTORY_UNAVAILABLE`).
- Zero requests receive `HTTP 500` (proving deadlocks were prevented by deterministic `ORDER BY product_id ASC` row locks).
- Show the final database query dump confirming `quantity_sold = 10`, `reserved_qty = 0`, and warehouse `on_hand_qty = 90`.

---

### Third: SafeMigrate Running in the Terminal

> [!NOTE]
> Transition the narrative: *"Now that we know FlashCart relies on strict database invariants, what happens when an engineer modifies the database schema? A dangerous migration can drop a column or take an exclusive table lock, taking down the entire marketplace."*

```
┌────────────────────────────────────────────────────────┐
│               SafeMigrate Analysis Engine              │
├────────────────────────────────────────────────────────┤
│  SQL Migration Fixture:                                │
│    ALTER TABLE products DROP COLUMN description;       │
│                                                        │
│  SQLGlot AST Parsing (PostgreSQL Dialect)              │
│    └─► Static AST Walk (Zero DB Connection Required)   │
│                                                        │
│  Policy Evaluation (--fail-on high):                   │
│    [!] Rule: SM002 (Destructive Column Drop)           │
│    [!] Severity: HIGH | Confidence: HIGH               │
│    [!] Exit Code: 1 (Policy Threshold Breached)        │
│                                                        │
│  Reports Generated:                                    │
│    ├─► demo_3_output.json (JSON v1.0)                  │
│    └─► demo_3_output.sarif (OASIS SARIF 2.1.0)        │
└────────────────────────────────────────────────────────┘
```

#### Command to Run Live:
```bash
cd /home/pr6thv3/flashcart_safemigrate_workspace/safemigrate

# 1. Scan intentionally risky migration fixture (destructive column drop):
python3 -m safemigrate scan \
  docs/evidence/demo_3_detection_proof/fixtures/drop_description.sql \
  --fail-on high \
  --format sarif \
  --output docs/evidence/demo_3_detection_proof/live_demo_3.sarif
```

#### Point Out Four Concrete Items on Screen:
1. **Detected Rule:** `SM002: Destructive Column Drop` on table `products`, column `description`.
2. **Severity & Confidence:** High Severity, High Confidence. Explains operational impact on rolling deployments.
3. **Machine-Readable Reports:** Conforming OASIS SARIF 2.1.0 and deterministic JSON v1.0.
4. **Standardized Exit Code:**
   ```bash
   echo $?
   # Returns 1 (Policy breached: blocks automated CI pipelines)
   ```

#### Contrast with Compatible Additive Fixture:
```bash
# 2. Scan safe additive migration (nullable column):
python3 -m safemigrate scan \
  ../flashcart/docs/evidence/demo_4_ci_integration/fixtures/pr2_additive_vendor_note.sql \
  --fail-on high

echo $?
# Returns 0 (Policy passed: backward-compatible change permitted)
```

> **Key Talking Point:**  
> *"SafeMigrate parses the SQL AST using SQLGlot; it does not connect to or execute any SQL against FlashCart's live database."*

---

### Fourth: Prove That Both Products Work Together (CI Integration Gate)

Show how SafeMigrate acts as an automated quality gate inside FlashCart's continuous integration workflow (`.github/workflows/safemigrate-gate.yml`).

```
                              GitHub Actions CI Workflow
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
      PR #101: Risky Migration                       PR #102: Additive Migration
    (DROP COLUMN description)                      (ADD COLUMN vendor_note)
                 │                                               │
                 ▼                                               ▼
         SafeMigrate Scan                                SafeMigrate Scan
   [Rule SM002 / Severity: HIGH]                   [No blocking policy rules]
                 │                                               │
                 ▼                                               ▼
           Exit Code: 1                                    Exit Code: 0
                 │                                               │
                 ▼                                               ▼
      ❌ CI FAILED (Merge Blocked)                   ✅ CI PASSED (Merge Allowed)
```

#### Command to Run Live:
```bash
cd /home/pr6thv3/flashcart_safemigrate_workspace/flashcart
bash tests/demonstrations/demo_4_ci_simulation.sh
```

#### Screen Inspection:
1. **PR #101 Simulation:**
   - Fixture: `ALTER TABLE products DROP COLUMN description;`
   - SafeMigrate flags `SM002` (High severity).
   - CI runner receives **Exit Code 1** and aborts with:  
     `❌ CI Gate Check FAILED: PR #101 blocked. Destructive change detected.`
2. **PR #102 Simulation:**
   - Fixture: `ALTER TABLE orders ADD COLUMN vendor_note TEXT;`
   - SafeMigrate finds zero policy breaches.
   - CI runner receives **Exit Code 0** and succeeds with:  
     `✅ CI Gate Check PASSED: PR #102 approved for automated deployment.`
3. **Code Scanning Integration:**
   - Open `docs/evidence/demo_4_ci_integration/pr1_risky_report.sarif`. Show that the OASIS SARIF format attaches directly to GitHub Code Scanning annotations on the exact line number of the pull request diff.

---

## 3. Spoken Presentation Script

*(Word-for-word rehearsal guide formatted for a natural 10-minute cadence)*

---

### [0:00 - 1:00] Opening: The Dual Problem

> "Good morning everyone.
> 
> Most e-commerce systems face two fundamental challenges that cause severe production outages:
> 1. **Under high traffic**, simultaneous checkouts cause race conditions that result in oversold inventory and broken customer trust.
> 2. **During continuous deployment**, unvetted database migrations lock active tables, drop columns still in use by rolling application containers, and take down live services.
> 
> Today, I am presenting this as **one connected engineering story**.
> 
> **FlashCart** is our multi-vendor marketplace with limited-stock flash sales, built to demonstrate real database concurrency problems and prove how strict transactional invariants prevent overselling.
> 
> **SafeMigrate** is the independent static risk analyzer we engineered to catch dangerous schema mutations in SQL migrations *before* they ever enter FlashCart’s deployment pipeline."

---

### [1:00 - 2:00] Architecture & Systems Overview

> "Let's examine how the two systems connect.
> 
> On the application side, FlashCart uses PostgreSQL 17 as its absolute source of truth across a 24-table normalized schema. The backend is an Express 5 API running Node.js, connected to a Next.js App Router storefront.
> 
> To guarantee zero overselling, we implemented deterministic ascending row locks and atomic conditional updates. Furthermore, we decoupled external payment processing from inventory transactions so external network delays never block database rows.
> 
> On the developer tooling side, SafeMigrate is written in Python 3.12+ using SQLGlot to parse PostgreSQL DDL into Abstract Syntax Trees. It requires zero live database connections and zero execution privileges. It evaluates AST rules against configured policy thresholds, emitting SARIF 2.1.0 reports.
> 
> Whenever an engineer pushes a migration to FlashCart, SafeMigrate scans the SQL file in CI. If the change introduces table locks or destructive column drops, CI fails and the PR cannot merge."

---

### [2:00 - 4:00] Live Demo 1: FlashCart Marketplace & Tenant Isolation

> *(Switch screen to browser at `http://localhost:3000`)*
> 
> "Here is the running FlashCart storefront.
> 
> At the top, you see an active flash sale with an authoritative countdown timer. In the catalog, we have products from multiple independent vendors: Apex Gear and Nova Sound.
> 
> Let's add the Ergonomic Desk from Apex Gear and the ANC Headphones from Nova Sound to our cart.
> 
> Notice what happens at checkout: the frontend never dictates pricing or stock availability. When we submit the order, the Express backend recalculates all item prices directly against PostgreSQL.
> 
> When I click 'Pay with Sandbox Provider', our decoupled payment processor validates the payload, holds an atomic reservation, and transitions the checkout into paid status.
> 
> Notice that behind the scenes, this single customer checkout was automatically divided into two vendor sub-orders: one for Apex Gear and one for Nova Sound.
> 
> Now let's switch to the vendor dashboard. I am logged in as Apex Gear. In my portal, I can see only my sub-order. If I attempt to inspect or fulfill Nova Sound's sub-order, the API rejects the request with HTTP 404. Tenant isolation is enforced at the database query layer."

---

### [4:00 - 6:00] Live Demo 2: The 200-Buyer Concurrency Proof

> *(Switch screen to terminal)*
> 
> "Now let's examine FlashCart’s most critical engineering test: protecting limited flash-sale stock under extreme concurrency.
> 
> I am going to launch an automated stress test: 200 distinct customer accounts simultaneously attempting to check out a flash sale capped at exactly 10 units.
> 
> *(Execute: `npx tsx tests/concurrency/flash_sale_200_concurrency.ts`)*
> 
> Watch the terminal. 200 requests were dispatched concurrently across a 948-millisecond window.
> 
> Here are the verified results:
> - **Accepted reservations (HTTP 201):** Exactly 10.
> - **Rejected conflicts (HTTP 409):** Exactly 190.
> - **Internal server errors (HTTP 5xx):** Exactly 0.
> 
> Look at the database verification output printed directly from PostgreSQL:
> - `quantity_sold`: 10
> - `quantity_reserved`: 0
> - `on_hand_qty`: 90 (down from 100)
> - `negative_stock_count`: 0
> 
> This proves that the browser does not decide who wins. Competing requests are resolved deterministically inside PostgreSQL. No customer was double-allocated, and not a single unit was oversold."

---

### [6:00 - 7:30] Live Demo 3: SafeMigrate Static AST Risk Detection

> *(Stay in terminal)*
> 
> "Now let’s transition to the second half of the story.
> 
> FlashCart’s inventory engine relies on specific schema columns and table constraints. What happens if a developer introduces a migration that drops the `description` column or adds a lock-heavy index?
> 
> That brings us to SafeMigrate.
> 
> Here is a test migration containing: `ALTER TABLE products DROP COLUMN description;`.
> 
> Let's scan it with SafeMigrate:
> *(Execute: `python3 -m safemigrate scan docs/evidence/demo_3_detection_proof/fixtures/drop_description.sql --fail-on high`)*
> 
> In less than 50 milliseconds, SafeMigrate parsed the SQL AST and flagged rule **`SM002: Destructive Column Drop`** on table `products`. It reported High Severity and High Confidence, and produced standard SARIF 2.1.0 output.
> 
> Check the CLI exit code:
> *(Execute: `echo $?`)*
> It returned **1**. The policy threshold was breached.
> 
> Crucially, SafeMigrate performed pure static AST parsing using SQLGlot. It never connected to or executed SQL against FlashCart’s live database."

---

### [7:30 - 9:00] Live Demo 4: CI Integration Gate

> *(Stay in terminal)*
> 
> "Now, let’s watch both tools work together in FlashCart’s development lifecycle.
> 
> We integrated SafeMigrate directly into FlashCart's pull request workflow.
> 
> Let’s simulate two pull requests:
> *(Execute: `bash tests/demonstrations/demo_4_ci_simulation.sh`)*
> 
> - **Pull Request #101** attempts to drop the `description` column. SafeMigrate detects rule `SM002`, emits Exit Code 1, and the CI gate terminates immediately, blocking the merge.
> - **Pull Request #102** adds a new, nullable `vendor_note` column to the `orders` table. SafeMigrate evaluates the AST, detects no breaking hazards, emits Exit Code 0, and the CI gate passes.
> 
> This provides automatic protection: risky schema changes are blocked at the PR review phase, while safe, additive changes merge seamlessly."

---

### [9:00 - 10:00] Conclusion: Evidence, Limits & Production Roadmap

> "To conclude:
> 
> FlashCart and SafeMigrate are two sides of the same reliability engineering coin:
> 1. **FlashCart** proves transactional correctness, zero overselling, and tenant isolation in the live runtime.
> 2. **SafeMigrate** proves static risk prevention and automated policy enforcement before deployment.
> 
> Our automated test suites back up every claim:
> - **99 Vitest suites** passing in FlashCart.
> - **72 Pytest suites** passing in SafeMigrate.
> - Full audit logs and SARIF reports are archived in `docs/evidence/` across both repositories on GitHub.
> 
> Before taking this platform to public production, our remaining roadmap items are:
> - Onboarding live PSP credentials (replacing the decoupled sandbox provider).
> - Production multi-AZ PostgreSQL hosting with read replicas.
> - Redis clustering for distributed rate-limiting.
> 
> Thank you, and I look forward to your questions."

---

## 4. Prepare Before You Present

### Pre-Presentation Checklist:

#### 1. Browser Tabs to Have Open:
- [x] **Storefront**: `http://localhost:3000` (Browse products, flash sale banner)
- [x] **Cart & Checkout**: `http://localhost:3000/cart`
- [x] **Vendor Portal**: `http://localhost:3000/vendor` (Logged in as `apex@example.com`)
- [x] **Customer Orders**: `http://localhost:3000/orders` (Logged in as `customer@example.com` or `frankdspunisher@gmail.com`)
- [x] **API Health Check**: `http://localhost:4000/api/v1/health` (Confirm `status: "ok"`)

#### 2. Demo Account Credentials (Ready to Paste):
| Role | Email | Password | Purpose |
|---|---|---|---|
| **Customer** | `customer@example.com` | `Password123!` | Public buyer checkout & cart flow |
| **Customer 2** | `frankdspunisher@gmail.com` | `Password123!` | Alternative buyer account |
| **Vendor 1** | `apex@example.com` | `Password123!` | Apex Gear portal (fulfill Order 1) |
| **Vendor 2** | `nova@example.com` | `Password123!` | Nova Sound portal (tenant isolation check) |
| **Platform Admin** | `admin@example.com` | `Password123!` | System overview |

#### 3. Pre-Staged Terminal Windows:
- **Terminal 1 (Concurrency Proof)**:
  ```bash
  cd /home/pr6thv3/flashcart_safemigrate_workspace/flashcart
  # Staged command ready to run:
  npx tsx tests/concurrency/flash_sale_200_concurrency.ts
  ```
- **Terminal 2 (SafeMigrate CLI)**:
  ```bash
  cd /home/pr6thv3/flashcart_safemigrate_workspace/safemigrate
  # Staged command ready to run:
  python3 -m safemigrate scan docs/evidence/demo_3_detection_proof/fixtures/drop_description.sql --fail-on high
  ```
- **Terminal 3 (CI Integration Gate Simulation)**:
  ```bash
  cd /home/pr6thv3/flashcart_safemigrate_workspace/flashcart
  # Staged command ready to run:
  bash tests/demonstrations/demo_4_ci_simulation.sh
  ```

#### 4. Backup Evidence Artifact Locations (If Live Run Fails):
If network latency or port collision interrupts a live command, open the pre-recorded logs immediately:
- **Demo 1 Logs**: [`flashcart/docs/evidence/demo_1_marketplace_workflow/DEMO_1_SUMMARY.md`](file:///home/pr6thv3/flashcart_safemigrate_workspace/flashcart/docs/evidence/demo_1_marketplace_workflow/DEMO_1_SUMMARY.md)
- **Demo 1 Sanitized DB**: [`sanitized_database_records.json`](file:///home/pr6thv3/flashcart_safemigrate_workspace/flashcart/docs/evidence/demo_1_marketplace_workflow/sanitized_database_records.json)
- **Demo 2 Concurrency Logs**: [`flashcart/docs/evidence/demo_2_flash_sale_concurrency/demo_2_console.log`](file:///home/pr6thv3/flashcart_safemigrate_workspace/flashcart/docs/evidence/demo_2_flash_sale_concurrency/demo_2_console.log)
- **Demo 2 DB Verification**: [`db_verification.json`](file:///home/pr6thv3/flashcart_safemigrate_workspace/flashcart/docs/evidence/demo_2_flash_sale_concurrency/db_verification.json)
- **Demo 3 SafeMigrate SARIF**: [`safemigrate/docs/evidence/demo_3_detection_proof/demo_3_output.sarif`](file:///home/pr6thv3/flashcart_safemigrate_workspace/safemigrate/docs/evidence/demo_3_detection_proof/demo_3_output.sarif)
- **Demo 4 PR Gate Logs**: [`flashcart/docs/evidence/demo_4_ci_integration/DEMO_4_SUMMARY.md`](file:///home/pr6thv3/flashcart_safemigrate_workspace/flashcart/docs/evidence/demo_4_ci_integration/DEMO_4_SUMMARY.md)

---

## 5. Summary of Verification Status

```
════════════════════════════════════════════════════════════════════════════════
  Component                 Suite Status        Tests Passed   Integrity
════════════════════════════════════════════════════════════════════════════════
  FlashCart Engine          Vitest              99 / 99        100% Verified
  SafeMigrate CLI           Pytest              72 / 72        100% Verified
  Next.js Storefront        App Router Build    10 / 10 Routes 100% Compiled
  PostgreSQL 17 DB          Docker Daemon       24 Tables      100% Healthy
  GitHub Repositories       Remote Push         15 Issues      Live on GitHub
════════════════════════════════════════════════════════════════════════════════
```
