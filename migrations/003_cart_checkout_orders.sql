-- Up
-- Migration 003: Carts, Cart Items, Checkouts, Checkout Items, Orders, Order Items, and Reservations

CREATE TABLE carts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_carts_user_id UNIQUE (user_id)
);

-- Foreign Key Supporting Index for SM010
CREATE INDEX idx_carts_user_id ON carts (user_id);

CREATE TABLE cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_cart_items_cart_product UNIQUE (cart_id, product_id),
    CONSTRAINT chk_cart_items_quantity_positive CHECK (quantity > 0)
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_cart_items_cart_id ON cart_items (cart_id);
CREATE INDEX idx_cart_items_product_id ON cart_items (product_id);

CREATE TABLE checkouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(255) NOT NULL,
    request_fingerprint VARCHAR(64),
    shipping_address_id UUID REFERENCES addresses(id) ON DELETE RESTRICT,
    status VARCHAR(30) NOT NULL DEFAULT 'created',
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    subtotal_minor BIGINT NOT NULL DEFAULT 0,
    discount_minor BIGINT NOT NULL DEFAULT 0,
    shipping_minor BIGINT NOT NULL DEFAULT 0,
    tax_minor BIGINT NOT NULL DEFAULT 0,
    total_minor BIGINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_checkouts_idempotency UNIQUE (customer_id, idempotency_key),
    CONSTRAINT chk_checkouts_status CHECK (status IN ('created', 'pending_payment', 'paid', 'failed', 'expired', 'cancelled')),
    CONSTRAINT chk_checkouts_totals CHECK (subtotal_minor >= 0 AND discount_minor >= 0 AND shipping_minor >= 0 AND tax_minor >= 0 AND total_minor >= 0)
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_checkouts_customer_id ON checkouts (customer_id);
CREATE INDEX idx_checkouts_shipping_address_id ON checkouts (shipping_address_id);
CREATE INDEX idx_checkouts_status_expires ON checkouts (status, expires_at);

CREATE TABLE checkout_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_id UUID NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    vendor_id UUID NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
    flash_sale_id UUID REFERENCES flash_sales(id) ON DELETE SET NULL,
    quantity INT NOT NULL,
    unit_price_minor BIGINT NOT NULL,
    total_minor BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_checkout_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_checkout_items_prices CHECK (unit_price_minor >= 0 AND total_minor >= 0)
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_checkout_items_checkout_id ON checkout_items (checkout_id);
CREATE INDEX idx_checkout_items_product_id ON checkout_items (product_id);
CREATE INDEX idx_checkout_items_vendor_id ON checkout_items (vendor_id);
CREATE INDEX idx_checkout_items_flash_sale_id ON checkout_items (flash_sale_id);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_id UUID NOT NULL REFERENCES checkouts(id) ON DELETE RESTRICT,
    vendor_id UUID NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    order_number VARCHAR(64) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'created',
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    subtotal_minor BIGINT NOT NULL DEFAULT 0,
    shipping_minor BIGINT NOT NULL DEFAULT 0,
    tax_minor BIGINT NOT NULL DEFAULT 0,
    total_minor BIGINT NOT NULL DEFAULT 0,
    shipping_address_snapshot JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_orders_checkout_vendor UNIQUE (checkout_id, vendor_id),
    CONSTRAINT uq_orders_order_number UNIQUE (order_number),
    CONSTRAINT chk_orders_status CHECK (status IN ('created', 'pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')),
    CONSTRAINT chk_orders_totals CHECK (subtotal_minor >= 0 AND shipping_minor >= 0 AND tax_minor >= 0 AND total_minor >= 0)
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_orders_checkout_id ON orders (checkout_id);
CREATE INDEX idx_orders_vendor_id ON orders (vendor_id);
CREATE INDEX idx_orders_customer_id ON orders (customer_id);
CREATE INDEX idx_orders_vendor_status_created ON orders (vendor_id, status, created_at DESC);
CREATE INDEX idx_orders_customer_created ON orders (customer_id, created_at DESC);

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    flash_sale_id UUID REFERENCES flash_sales(id) ON DELETE SET NULL,
    sku_snapshot VARCHAR(100) NOT NULL,
    title_snapshot VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    unit_price_minor BIGINT NOT NULL,
    total_minor BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_order_items_quantity CHECK (quantity > 0),
    CONSTRAINT chk_order_items_prices CHECK (unit_price_minor >= 0 AND total_minor >= 0)
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_order_items_order_id ON order_items (order_id);
CREATE INDEX idx_order_items_product_id ON order_items (product_id);
CREATE INDEX idx_order_items_flash_sale_id ON order_items (flash_sale_id);

CREATE TABLE inventory_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_id UUID NOT NULL REFERENCES checkouts(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    flash_sale_id UUID REFERENCES flash_sales(id) ON DELETE SET NULL,
    quantity INT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_reservations_quantity CHECK (quantity > 0),
    CONSTRAINT chk_reservations_status CHECK (status IN ('pending', 'consumed', 'released', 'expired'))
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_inventory_reservations_checkout_id ON inventory_reservations (checkout_id);
CREATE INDEX idx_inventory_reservations_product_id ON inventory_reservations (product_id);
CREATE INDEX idx_inventory_reservations_flash_sale_id ON inventory_reservations (flash_sale_id);
CREATE INDEX idx_reservations_sweeper ON inventory_reservations (status, expires_at) WHERE status = 'pending';

-- Down
-- DROP TABLE IF EXISTS inventory_reservations CASCADE;
-- DROP TABLE IF EXISTS order_items CASCADE;
-- DROP TABLE IF EXISTS orders CASCADE;
-- DROP TABLE IF EXISTS checkout_items CASCADE;
-- DROP TABLE IF EXISTS checkouts CASCADE;
-- DROP TABLE IF EXISTS cart_items CASCADE;
-- DROP TABLE IF EXISTS carts CASCADE;
