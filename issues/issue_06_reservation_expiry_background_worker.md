# Issue: Reservation Expiry Background Sweeper

## Description
Implement a lightweight PostgreSQL-backed background worker to sweep expired reservations.

## Acceptance Criteria
- [ ] Worker queries expired pending reservations using `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 100`.
- [ ] Safely decrements `quantity_reserved` and marks reservation rows as `expired`.
- [ ] Operates concurrently with active checkout traffic without deadlocks.
