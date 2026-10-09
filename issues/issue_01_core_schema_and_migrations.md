# Issue: Core Database Schema and Migrations

## Description
Establish the primary PostgreSQL database schema using raw `.sql` migrations and `node-pg-migrate`.

## Acceptance Criteria
- [ ] Implement tables: `users`, `roles`, `user_roles`, `vendor_profiles`, `addresses`, `categories`, `products`, `product_images`, `inventory`, `flash_sales`, `carts`, `cart_items`, `checkouts`, `orders`, `order_items`, `inventory_reservations`, `payment_attempts`, `payment_webhook_events`, `audit_log`, `outbox_jobs`, `sessions`.
- [ ] Database enforces check constraints: `on_hand_qty >= 0`, `reserved_qty >= 0`, `reserved_qty <= on_hand_qty`, and `quantity_reserved + quantity_sold <= quantity_limit`.
- [ ] All timestamps are stored as `timestamptz` in UTC.
- [ ] Money stored as integer minor units (`price_minor`).
- [ ] Migrations are formatted as raw `.sql` files (`up.sql` and `down.sql`).
- [ ] Clean database initialization and rollback verification tests pass against disposable PostgreSQL 17 container.
