# Issue: Complete Database Schema and Migrations

## Description
Establish the primary PostgreSQL database schema using raw `.sql` migrations and `node-pg-migrate`, covering all identity, catalog, order, payment, and audit tables.

## Acceptance Criteria
- [ ] Implement complete schema tables:
  - `users`, `roles`, `user_roles`, `sessions`, `vendor_profiles`, `addresses`
  - `categories`, `products`, `product_images`, `inventory`, `flash_sales`
  - `carts`, `cart_items`, `checkouts`, `checkout_items`, `orders`, `order_items`, `inventory_reservations`
  - `payment_attempts`, `payment_webhook_events`, `refunds`, `order_status_history`
  - `audit_log`, `outbox_jobs`, and tracked migration history table.
- [ ] Database enforces check constraints: `on_hand_qty >= 0`, `reserved_qty >= 0`, `reserved_qty <= on_hand_qty`, and `quantity_reserved + quantity_sold <= quantity_limit`.
- [ ] Unique constraint enforced on `(checkout_id, vendor_id)` preventing duplicate vendor sub-orders.
- [ ] Historical price, title, and SKU values are snapshotted in `order_items`.
- [ ] Foreign-key referencing columns include supporting index policy (compatible with SafeMigrate `SM010`).
- [ ] Migration runner configures `migration_transaction_mode` (transaction wrapped by default; non-wrapped for concurrent index creation).
- [ ] Clean database initialization and rollback verification tests pass against disposable PostgreSQL 17 container.
