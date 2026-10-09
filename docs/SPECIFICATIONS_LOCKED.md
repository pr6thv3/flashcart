# FlashCart — Locked Engineering Specifications & ADRs

**Status:** Locked Engineering Baseline  
**Sign-off Date:** 2026-10-09  
**Specification Origin:** Documents 01–08 (`/home/pr6thv3/Documents/flashcart_safemigrate_spec_pack`)

## 1. Locked Architecture Decisions (ADR Summary)

- **ADR-001 (Two Repositories):** `flashcart` and `safemigrate` are separate repositories. FlashCart pins a released/tagged SafeMigrate version in CI; production behavior never depends on unpinned branches.
- **ADR-002 (PostgreSQL Authoritative Source of Truth):** PostgreSQL is authoritative for stock, orders, checkouts, and payment states. No Redis/cache in the critical transactional path.
- **ADR-003 (Database Runtime Baseline):** Pinned to **PostgreSQL 17** for local Docker Compose and CI execution (with forward-compatibility for PostgreSQL 18).
- **ADR-004 (Explicit SQL & Raw .sql Migrations):** Repository queries use `pg` with explicit SQL. Migrations are written as raw `.sql` files (`up.sql` / `down.sql`) to enable direct SQLGlot AST analysis by SafeMigrate.
- **ADR-005 (Same-Origin Session Security):** Web and API are routed under the same origin. Opaque session IDs in `HttpOnly`, `SameSite=Lax`, `Secure` cookies. Next.js `rewrites()` proxies `/api` to Express in development.
- **ADR-006 (Zero-Oversell Checkout Protocol):** Phase A acquires row locks in ascending `product_id` order or executes atomic conditional updates (`UPDATE flash_sales SET quantity_reserved = quantity_reserved + $1 WHERE id = $2 AND quantity_reserved + quantity_sold + $1 <= quantity_limit`). Payment execution (Phase B) occurs outside database locks.
- **ADR-007 (Reservation Sweeper Worker):** Expired reservations are swept using `SELECT ... FOR UPDATE SKIP LOCKED` without external message queues.
- **ADR-008 (Conditional Decisions):** Production payment provider and production hosting remain conditional until business eligibility, fees, and operational terms are confirmed. Local/test environments use sandbox payment doubles.

## 2. Evidence Milestones (Document 08)

1. **Demonstration 1:** Marketplace storefront, customer checkout, vendor isolation, database state inspection.
2. **Demonstration 2:** Concurrency test: 10 units flash sale under 200 simultaneous checkout requests; zero oversell, zero negative stock, exactly 10 units admitted.
