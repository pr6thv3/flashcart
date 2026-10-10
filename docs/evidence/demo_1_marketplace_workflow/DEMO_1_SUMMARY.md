# Demonstration 1: Multi-Vendor Marketplace Workflow Summary

**Demonstration ID:** `DEMO-01-MARKETPLACE-WORKFLOW`  
**Requirement Reference:** ORIGINAL_REQUEST.md §R4, Document 08 §Demo 1, Milestone M5  
**Execution Timestamp:** 2026-10-10T03:29:02.741Z  
**Git Commit SHA:** `eb53847`  
**Target Repository:** `pr6thv3/flashcart`  
**Environment:** Node v26.8.1, PostgreSQL 17 (Docker)  

---

## 1. Executive Summary & Objective

Demonstration 1 provides empirical, reproducible verification of the complete FlashCart multi-vendor marketplace customer journey, decoupled payment architecture, and strict server-enforced tenant isolation. The end-to-end flow exercises:
1. Customer lifecycle (registration, authentication, catalog browsing).
2. Multi-vendor cart aggregation with server-revalidated subtotal calculations.
3. Transactional checkout reservation creating a parent checkout and isolated vendor sub-orders enforcing `UNIQUE (checkout_id, vendor_id)`.
4. Decoupled sandbox payment transitioning order states to `paid` and decrementing warehouse inventory without lock contention during payment processing.
5. Vendor portal isolation proving that Vendor 1 can view and fulfill only their own sub-order while Vendor 2's sub-order remains unfulfilled and unmutated.
6. Extraction and sanitization of database records from `checkouts`, `orders`, `order_items`, `payment_attempts`, and `inventory_reservations`.

---

## 2. Test Execution Details

- **Execution Command:** `npx tsx tests/demonstrations/demo_1_marketplace_flow.ts`
- **Run ID:** `mv1u4tnd975ec4`
- **Parent Checkout ID:** `3e1e8ef7-4603-445f-98d6-475dbde56f42`
- **Vendor 1 Sub-Order ID:** `e8598f04-f10f-44e1-9928-6819f4c87221`
- **Vendor 2 Sub-Order ID:** `72ef931c-cae2-4fcd-8745-506fdcce5478`

---

## 3. Empirical Verification Results

| Step | Operation | Invariant / Expected State | Observed State | Status |
|:---:|---|---|---|:---:|
| 1 | Customer Registration & Login | User created in `users` table with role `customer`; valid session token returned | HTTP 201 Created; HTTP 200 Login with valid JWT session | **VERIFIED** |
| 2 | Catalog Browsing | Public catalog lists products from multiple vendors | Both vendor products listed with correct price and stock | **VERIFIED** |
| 3 | Multi-Vendor Cart | Items from 2 distinct vendors added; server revalidates prices (2*4500 + 1*2200 = 11200 minor) | Authoritative cart subtotal ₹112.00 (11200 minor) | **VERIFIED** |
| 4 | Checkout Reservation | Parent checkout created; 2 distinct vendor sub-orders created; `UNIQUE(checkout_id, vendor_id)` enforced | Checkout `3e1e8ef7-4603-445f-98d6-475dbde56f42` created with 2 sub-orders | **VERIFIED** |
| 5 | Sandbox Payment | Decoupled payment executes; inventory transactions do NOT span external calls; orders transition to `paid` | Checkout and both sub-orders transition to `paid`; stock decremented | **VERIFIED** |
| 6 | Vendor Tenant Isolation | Vendor 1 lists orders: sees only Vendor 1 sub-order; Vendor 2 sub-order hidden | Vendor 1 sees `e8598f04-f10f-44e1-9928-6819f4c87221`; cannot see `72ef931c-cae2-4fcd-8745-506fdcce5478` | **VERIFIED** |
| 7 | Zero-IDOR Protection | Vendor 1 attempts to fulfill Vendor 2 sub-order | HTTP 404 NOT_FOUND returned; Vendor 2 sub-order unmodified | **VERIFIED** |
| 8 | Sub-Order Fulfillment | Vendor 1 fulfills Vendor 1 sub-order | Vendor 1 sub-order updated to `shipped`; Vendor 2 sub-order remains `paid` | **VERIFIED** |
| 9 | Database Extraction | Full audit trail dumped and sanitized across 5 tables | Sanitized JSON generated in `sanitized_database_records.json` | **VERIFIED** |

---

## 4. Artifact Index

- **Console Log:** `demo_1_console.log`
- **Sanitized DB Records:** `sanitized_database_records.json`
- **Run Manifest:** `demonstration_manifest.json`
- **Summary Report:** `DEMO_1_SUMMARY.md`

**Conclusion:** Demonstration 1 executed with 100% invariant compliance and zero IDOR leakage.
