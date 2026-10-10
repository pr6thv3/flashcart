import { query } from '../../db/pool.js';

export interface CatalogProductDTO {
  id: string;
  vendor_id: string;
  vendor_store_name: string;
  category_id: string | null;
  category_name?: string;
  title: string;
  slug: string;
  sku: string;
  description: string;
  price_minor: number;
  price_cents?: number;
  currency: string;
  status: string;
  on_hand_qty: number;
  reserved_qty: number;
  available_qty: number;
}

export interface ActiveFlashSaleDTO {
  id: string;
  product_id: string;
  product_title: string;
  vendor_id: string;
  vendor_store_name: string;
  title: string;
  sale_price_minor: number;
  sale_price_cents?: number;
  regular_price_minor: number;
  currency: string;
  quantity_limit: number;
  quantity_reserved: number;
  quantity_sold: number;
  available_sale_qty: number;
  starts_at: Date;
  ends_at: Date;
  is_active: boolean;
}

export class CatalogRepository {
  async listProducts(): Promise<CatalogProductDTO[]> {
    const res = await query<any>(
      `SELECT p.id, p.vendor_id, p.category_id, p.title, p.slug, p.sku, p.description,
              p.price_minor, p.currency, p.status,
              vp.store_name as vendor_store_name,
              c.name as category_name,
              COALESCE(i.on_hand_qty, 0) as on_hand_qty,
              COALESCE(i.reserved_qty, 0) as reserved_qty
       FROM products p
       JOIN vendor_profiles vp ON vp.id = p.vendor_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.status = 'published' AND vp.status = 'approved'
       ORDER BY p.created_at DESC`
    );

    return res.rows.map((row) => ({
      id: row.id,
      vendor_id: row.vendor_id,
      vendor_store_name: row.vendor_store_name,
      category_id: row.category_id,
      category_name: row.category_name,
      title: row.title,
      slug: row.slug,
      sku: row.sku,
      description: row.description,
      price_minor: Number(row.price_minor),
      price_cents: Number(row.price_minor),
      currency: row.currency,
      status: row.status,
      on_hand_qty: row.on_hand_qty,
      reserved_qty: row.reserved_qty,
      available_qty: Math.max(0, row.on_hand_qty - row.reserved_qty),
    }));
  }

  async getProductById(idOrSlug: string): Promise<CatalogProductDTO | null> {
    const res = await query<any>(
      `SELECT p.id, p.vendor_id, p.category_id, p.title, p.slug, p.sku, p.description,
              p.price_minor, p.currency, p.status,
              vp.store_name as vendor_store_name,
              c.name as category_name,
              COALESCE(i.on_hand_qty, 0) as on_hand_qty,
              COALESCE(i.reserved_qty, 0) as reserved_qty
       FROM products p
       JOIN vendor_profiles vp ON vp.id = p.vendor_id
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE (p.id::text = $1 OR p.slug = $1)
         AND p.status = 'published' AND vp.status = 'approved'`,
      [idOrSlug]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return {
      id: row.id,
      vendor_id: row.vendor_id,
      vendor_store_name: row.vendor_store_name,
      category_id: row.category_id,
      category_name: row.category_name,
      title: row.title,
      slug: row.slug,
      sku: row.sku,
      description: row.description,
      price_minor: Number(row.price_minor),
      price_cents: Number(row.price_minor),
      currency: row.currency,
      status: row.status,
      on_hand_qty: row.on_hand_qty,
      reserved_qty: row.reserved_qty,
      available_qty: Math.max(0, row.on_hand_qty - row.reserved_qty),
    };
  }

  async listActiveFlashSales(): Promise<ActiveFlashSaleDTO[]> {
    const res = await query<any>(
      `SELECT fs.id, fs.product_id, fs.vendor_id, fs.title, fs.sale_price_minor,
              fs.currency, fs.quantity_limit, fs.quantity_reserved, fs.quantity_sold,
              fs.starts_at, fs.ends_at, fs.is_active,
              p.title as product_title, p.price_minor as regular_price_minor,
              vp.store_name as vendor_store_name
       FROM flash_sales fs
       JOIN products p ON p.id = fs.product_id
       JOIN vendor_profiles vp ON vp.id = fs.vendor_id
       WHERE fs.is_active = true
         AND fs.starts_at <= clock_timestamp()
         AND fs.ends_at > clock_timestamp()
         AND p.status = 'published'
         AND vp.status = 'approved'
       ORDER BY fs.starts_at ASC`
    );

    return res.rows.map((row) => ({
      id: row.id,
      product_id: row.product_id,
      product_title: row.product_title,
      vendor_id: row.vendor_id,
      vendor_store_name: row.vendor_store_name,
      title: row.title,
      sale_price_minor: Number(row.sale_price_minor),
      sale_price_cents: Number(row.sale_price_minor),
      regular_price_minor: Number(row.regular_price_minor),
      currency: row.currency,
      quantity_limit: row.quantity_limit,
      quantity_reserved: row.quantity_reserved,
      quantity_sold: row.quantity_sold,
      available_sale_qty: Math.max(
        0,
        row.quantity_limit - (row.quantity_reserved + row.quantity_sold)
      ),
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      is_active: row.is_active,
    }));
  }

  async getFlashSaleById(id: string): Promise<ActiveFlashSaleDTO | null> {
    const res = await query<any>(
      `SELECT fs.id, fs.product_id, fs.vendor_id, fs.title, fs.sale_price_minor,
              fs.currency, fs.quantity_limit, fs.quantity_reserved, fs.quantity_sold,
              fs.starts_at, fs.ends_at, fs.is_active,
              p.title as product_title, p.price_minor as regular_price_minor,
              vp.store_name as vendor_store_name
       FROM flash_sales fs
       JOIN products p ON p.id = fs.product_id
       JOIN vendor_profiles vp ON vp.id = fs.vendor_id
       WHERE fs.id = $1`,
      [id]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return {
      id: row.id,
      product_id: row.product_id,
      product_title: row.product_title,
      vendor_id: row.vendor_id,
      vendor_store_name: row.vendor_store_name,
      title: row.title,
      sale_price_minor: Number(row.sale_price_minor),
      sale_price_cents: Number(row.sale_price_minor),
      regular_price_minor: Number(row.regular_price_minor),
      currency: row.currency,
      quantity_limit: row.quantity_limit,
      quantity_reserved: row.quantity_reserved,
      quantity_sold: row.quantity_sold,
      available_sale_qty: Math.max(
        0,
        row.quantity_limit - (row.quantity_reserved + row.quantity_sold)
      ),
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      is_active: row.is_active,
    };
  }
}
