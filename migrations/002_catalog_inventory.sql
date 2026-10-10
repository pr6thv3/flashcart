-- Up
-- Migration 002: Catalog, Products, Images, Inventory, and Flash Sales

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_categories_slug UNIQUE (slug)
);

-- Foreign Key Supporting Index for SM010
CREATE INDEX idx_categories_parent_id ON categories (parent_id);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    sku VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    price_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(30) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_products_sku UNIQUE (sku),
    CONSTRAINT uq_products_slug UNIQUE (slug),
    CONSTRAINT chk_products_price_positive CHECK (price_minor > 0),
    CONSTRAINT chk_products_status CHECK (status IN ('draft', 'published', 'archived'))
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_products_vendor_id ON products (vendor_id);
CREATE INDEX idx_products_category_id ON products (category_id);
CREATE INDEX idx_products_status_category ON products (status, category_id);
CREATE INDEX idx_products_vendor_status ON products (vendor_id, status);

CREATE TABLE product_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    object_key VARCHAR(500) NOT NULL,
    url TEXT NOT NULL,
    alt_text VARCHAR(255),
    sort_order INT NOT NULL DEFAULT 0,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Foreign Key Supporting Index for SM010
CREATE INDEX idx_product_images_product_id ON product_images (product_id);
CREATE INDEX idx_product_images_product_sort ON product_images (product_id, sort_order);

CREATE TABLE inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    on_hand_qty INT NOT NULL DEFAULT 0,
    reserved_qty INT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_inventory_product_id UNIQUE (product_id),
    CONSTRAINT chk_inventory_qty_invariants CHECK (on_hand_qty >= 0 AND reserved_qty >= 0 AND reserved_qty <= on_hand_qty)
);

-- Foreign Key Supporting Index for SM010
CREATE INDEX idx_inventory_product_id ON inventory (product_id);

CREATE TABLE flash_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    vendor_id UUID NOT NULL REFERENCES vendor_profiles(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    sale_price_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    quantity_limit INT NOT NULL,
    quantity_reserved INT NOT NULL DEFAULT 0,
    quantity_sold INT NOT NULL DEFAULT 0,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT chk_flash_sales_quantities CHECK (quantity_limit >= 0 AND quantity_reserved >= 0 AND quantity_sold >= 0 AND quantity_reserved + quantity_sold <= quantity_limit),
    CONSTRAINT chk_flash_sales_time_window CHECK (ends_at > starts_at),
    CONSTRAINT chk_flash_sales_price CHECK (sale_price_minor > 0)
);

-- Foreign Key Supporting Indexes for SM010
CREATE INDEX idx_flash_sales_product_id ON flash_sales (product_id);
CREATE INDEX idx_flash_sales_vendor_id ON flash_sales (vendor_id);
CREATE INDEX idx_flash_sales_active_window ON flash_sales (is_active, starts_at, ends_at);

-- Down
-- DROP TABLE IF EXISTS flash_sales CASCADE;
-- DROP TABLE IF EXISTS inventory CASCADE;
-- DROP TABLE IF EXISTS product_images CASCADE;
-- DROP TABLE IF EXISTS products CASCADE;
-- DROP TABLE IF EXISTS categories CASCADE;
