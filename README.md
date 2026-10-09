# FlashCart

A multi-vendor marketplace with limited-stock flash sales, built with PostgreSQL as the transactional source of truth, an Express API, and a Next.js storefront.

## Core Invariants

1. **Zero Overselling**: The database is authoritative for stock, sales, orders, and payments. Contested flash sales guarantee that total reservations and sales never exceed the sale limit (`quantity_reserved + quantity_sold <= quantity_limit`).
2. **Server-Enforced Authorization**: Permissions for customers, vendors, and platform administrators are enforced at the service and SQL boundaries.
3. **Idempotent Operations**: Checkout requests and payment webhooks require idempotency keys and transactional deduplication.
4. **Isolated Safe Migrations**: Schema migrations are tracked in versioned SQL files and scanned in CI by [SafeMigrate](https://github.com/pr6thv3/safemigrate) before merging.

## Demonstrations & Evidence (Document 08)

FlashCart provides the testbeds for two central empirical demonstrations:
- **Demonstration 1 (Marketplace Flow)**: End-to-end customer order journey and vendor catalog/fulfillment isolation.
- **Demonstration 2 (Stock Protection Under Contention)**: 10 sale units subjected to 200 concurrent 1-unit checkout requests with 0 overselling and no negative inventory.

## Architecture

- **Web Frontend**: Next.js (App Router, TypeScript, React)
- **API Backend**: Node.js 24 LTS, TypeScript, Express
- **Database**: PostgreSQL 17 (Docker Compose / Managed PG)
- **Database Driver**: `pg` (node-postgres) with explicit transaction and row-locking boundaries
- **Migrations**: `node-pg-migrate` utilizing raw `.sql` migration files
- **CI / Gate**: GitHub Actions with pinned SafeMigrate scanning
