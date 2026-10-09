# FlashCart — Locked Engineering Specifications & ADRs

**Status:** Locked Engineering Baseline (Fully Approved)  
**Sign-off Date:** 2026-10-09  
**Specification Origin:** Documents 01–08 + `REVIEW_DECISIONS.md`

## 1. Locked Architecture Decisions (ADRs)

- **ADR-001 (Two Repositories):** `flashcart` and `safemigrate` are separate repositories. FlashCart CI pins a released/tagged SafeMigrate version or immutable commit SHA; production and CI never depend on unpinned branches.
- **ADR-002 (PostgreSQL Authoritative Source of Truth):** PostgreSQL is authoritative for stock, orders, checkouts, and payment states. No Redis/cache in the critical transactional path.
- **ADR-003 (Database Runtime Baseline):** Pinned to **PostgreSQL 17** for local Docker Compose and CI execution (with forward-compatibility for PostgreSQL 18).
- **ADR-004 (Explicit SQL & Raw .sql Migrations):** Repository queries use `pg` with explicit SQL. Migrations are written as raw `.sql` files (`up.sql` / `down.sql`) to enable direct SQLGlot AST analysis by SafeMigrate.
- **ADR-005 (Complete Database Schema):** Complete schema covering:
  - Identity & Access: `users`, `roles`, `user_roles`, `sessions`, `vendor_profiles`, `addresses`
  - Catalog & Stock: `categories`, `products`, `product_images`, `inventory`, `flash_sales`
  - Checkout & Orders: `carts`, `cart_items`, `checkouts`, `checkout_items`, `orders`, `order_items`, `inventory_reservations`
  - Payments & Auditing: `payment_attempts`, `payment_webhook_events`, `refunds`, `order_status_history`, `audit_log`, `outbox_jobs`
  - Tooling: Tracked migration-history table.
  - Enforce `UNIQUE(checkout_id, vendor_id)` and immutable historical snapshots on order items.
- **ADR-006 (Zero-Oversell Checkout & Two-Phase Evidence Protocol):**
  - Phase 1 (Reservation): Ascending `product_id` row locking / atomic conditional updates (`UPDATE flash_sales SET quantity_reserved = quantity_reserved + $1 WHERE id = $2 AND quantity_reserved + quantity_sold + $1 <= quantity_limit`).
  - Phase 2 (Payment Finalization): External payment outside DB locks. Separate assertion that confirmed payments transition reservations to sales exactly once.
- **ADR-007 (Reservation Sweeper Worker):** Expired reservations are swept using `SELECT ... FOR UPDATE SKIP LOCKED` without external message queues.
- **ADR-008 (Transaction-Aware Runner Mode):** FlashCart migration runner configures `migration_transaction_mode = wrapped` for transactional DDL, and explicitly disables transaction wrapping when running migrations containing `CREATE INDEX CONCURRENTLY` (matching SafeMigrate `SM005`).
- **ADR-009 (Session & Payment Security):** Server-managed sessions in PostgreSQL with opaque `HttpOnly`, `SameSite=Lax`, `Secure` cookies; Argon2id password hashing; CSRF/origin checks on cookie-authenticated writes; idempotent checkouts scoped by actor fingerprint; late webhook refund compensation.
- **ADR-010 (Conditional Decisions):** Production payment provider and production hosting remain conditional until business eligibility, fees, and operational terms are confirmed. Local/test environments use sandbox payment doubles.

## 2. Evidence Milestones (Document 08)

1. **Demonstration 1:** Marketplace storefront, customer checkout, vendor isolation, database state inspection.
2. **Demonstration 2 (Two-Part Concurrency Proof):**
   - **Part A:** 200 concurrent requests competing for 10 sale units; exactly 10 reservations accepted, 190 receive 409 conflict, zero negative stock, no constraint violation.
   - **Part B:** Deterministic sandbox payment completion proves confirmed reservations convert to sales exactly once without duplicate finalization.
3. **Demonstration 3:** SafeMigrate detects risky migration (`drop_description.sql`) with rule ID `SM002`, severity `high`, confidence `high`, SARIF/JSON report, and exit code 1.
4. **Demonstration 4:** Pinned SafeMigrate release in CI blocks risky migration PR and passes compatible additive migration PR (`add_vendor_note.sql`).
