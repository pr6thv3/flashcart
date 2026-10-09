# Issue: Multi-Vendor Catalog, Cart and Vendor Isolation

## Description
Implement catalog browsing, multi-vendor cart management, and server-enforced vendor data isolation.

## Acceptance Criteria
- [ ] Public catalog endpoints: `/api/v1/products`, `/api/v1/products/:slug`, `/api/v1/categories`.
- [ ] Multi-vendor cart: Cart items can originate from different vendors; server recalculates prices and stock eligibility.
- [ ] Vendor API: `/api/v1/vendor/products`, `/api/v1/vendor/orders`.
- [ ] Vendor isolation: Vendor A cannot read, update, or fulfill products and orders belonging to Vendor B.
- [ ] Automated IDOR tests verify cross-tenant boundaries.
