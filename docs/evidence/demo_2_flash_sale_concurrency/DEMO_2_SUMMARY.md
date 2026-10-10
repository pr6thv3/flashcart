# Demonstration 2: Flash Sale 200-Concurrency Proof Summary

**Demonstration ID:** `DEMO-02-FLASH-SALE-CONCURRENCY`  
**Requirement Reference:** ORIGINAL_REQUEST.md §R4, Document 08 §Demo 2, Milestone M5  
**Execution Timestamp:** 2026-10-10T03:05:42.468Z  
**Git Commit SHA:** `eb53847`  
**Target Repository:** `pr6thv3/flashcart`  
**Environment:** Node v26.8.1, PostgreSQL 17 (Docker)  

---

## 1. Executive Summary & Objective

Demonstration 2 provides verifiable empirical proof that FlashCart's transactional engine enforces zero overselling under high concurrency contention. In this demonstration:
- **Part A (Reservation Invariant Proof):** A fresh flash sale offering exactly 10 units is subjected to 200 simultaneous 1-unit checkout reservation requests from 200 distinct customer accounts with unique idempotency keys. Exactly 10 requests obtain HTTP 201 reservations, while the remaining 190 requests receive clean HTTP 409 conflict responses (`INVENTORY_UNAVAILABLE`) with zero 500 server errors.
- **Part B (Payment Conversion Proof):** Decoupled sandbox payments are executed against the 10 accepted reservations, transitioning them to `sold`, permanently decrementing physical warehouse stock from 100 to 90, and verifying zero negative stock or duplicate order finalization.

---

## 2. Test Execution Details

- **Command Executed:** `npx tsx tests/concurrency/flash_sale_200_concurrency.ts`
- **Run ID:** `mv1tasooy12y`
- **Total Concurrent Requests:** 200
- **Flash Sale Quota:** 10 units
- **Initial Warehouse Stock:** 100 units
- **Total Wall-Clock Elapsed Time:** 948ms

---

## 3. Results Summary Table (Document 08 Template)

| Metric | Specification Target | Observed Result | Pass / Fail |
|---|---|---|:---:|
| **Concurrent Requests** | 200 distinct buyer users | 200 requests launched | **PASS** |
| **Accepted Reservations (HTTP 201)** | Exactly 10 | 10 | **PASS** |
| **Rejected Conflicts (HTTP 409)** | Exactly 190 (`INVENTORY_UNAVAILABLE`) | 190 | **PASS** |
| **Server Errors (HTTP 5xx)** | Exactly 0 | 0 | **PASS** |
| **Latency Min / Avg / P95 / Max** | Sub-second concurrency | 240ms / 676ms / 921ms / 941ms | **PASS** |
| **Flash Sale Final State** | `quantity_sold = 10`, `reserved = 0` | sold=10, reserved=0 | **PASS** |
| **Warehouse Stock Final State** | `on_hand_qty = 90` (100 - 10) | on_hand=90, reserved=0 | **PASS** |
| **Negative Stock Count** | 0 negative values | 0 | **PASS** |
| **Final Order Status** | Exactly 10 paid vendor orders | 10 paid orders | **PASS** |

---

## 4. Invariant Verification Chain

1. **Deterministic Row Locking & Conditional Updates:**
   - Database transactions execute conditional checks (`WHERE quantity_reserved + quantity_sold + $1 <= quantity_limit`) ensuring no race condition can breach the limit.
2. **Strict Database Check Constraints:**
   - `chk_inventory_non_negative`: `on_hand_qty >= 0 AND reserved_qty >= 0 AND reserved_qty <= on_hand_qty`
   - `chk_flash_sales_limits`: `quantity_reserved + quantity_sold <= quantity_limit`
   Neither constraint was violated during all 200 simultaneous queries.
3. **Decoupled Payment Isolation:**
   - External payments do not hold inventory locks; inventory transitions from `pending` to `consumed` cleanly upon payment settlement.

---

## 5. Artifact Index

- **Console Log:** `demo_2_console.log`
- **Terminal Output:** `terminal_output.txt`
- **Run Manifest:** `demonstration_manifest.json`
- **Database Verification:** `db_verification.json`
- **Summary Report:** `DEMO_2_SUMMARY.md`

**Conclusion:** Demonstration 2 passed with 100% adherence to zero-overselling and database invariant guarantees.
