import { query, withTransaction } from '../../db/pool.js';
import { CreateProductInput, UpdateProductInput } from './vendor.schemas.js';

export interface VendorProductRecord {
  id: string;
  vendor_id: string;
  category_id: string | null;
  title: string;
  slug: string;
  sku: string;
  description: string;
  price_minor: string;
  currency: string;
  status: string;
  on_hand_qty: number;
  reserved_qty: number;
  created_at: Date;
  updated_at: Date;
}

export interface VendorOrderRecord {
  id: string;
  checkout_id: string;
  vendor_id: string;
  customer_id: string;
  order_number: string;
  status: string;
  currency: string;
  subtotal_minor: string;
  shipping_minor: string;
  tax_minor: string;
  total_minor: string;
  shipping_address_snapshot: any;
  created_at: Date;
  updated_at: Date;
  items?: any[];
}

export class VendorRepository {
  async getProfile(vendorId: string) {
    const res = await query(
      `SELECT id, user_id, store_name, slug, description, status, created_at, updated_at
       FROM vendor_profiles
       WHERE id = $1`,
      [vendorId]
    );
    return res.rows[0] || null;
  }

  async listProducts(vendorId: string): Promise<VendorProductRecord[]> {
    const res = await query<VendorProductRecord>(
      `SELECT p.*, COALESCE(i.on_hand_qty, 0) as on_hand_qty, COALESCE(i.reserved_qty, 0) as reserved_qty
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.vendor_id = $1
       ORDER BY p.created_at DESC`,
      [vendorId]
    );
    return res.rows;
  }

  async createProduct(
    vendorId: string,
    input: CreateProductInput
  ): Promise<VendorProductRecord> {
    return await withTransaction(async (client) => {
      const prodRes = await client.query<VendorProductRecord>(
        `INSERT INTO products (
           vendor_id, category_id, title, slug, sku, description,
           price_minor, currency, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          vendorId,
          input.categoryId || null,
          input.title,
          input.slug,
          input.sku,
          input.description,
          input.priceMinor,
          input.currency,
          input.status,
        ]
      );
      const product = prodRes.rows[0];

      await client.query(
        `INSERT INTO inventory (product_id, on_hand_qty, reserved_qty)
         VALUES ($1, $2, 0)`,
        [product.id, input.initialStock]
      );

      return {
        ...product,
        on_hand_qty: input.initialStock,
        reserved_qty: 0,
      };
    });
  }

  async updateProduct(
    vendorId: string,
    productId: string,
    input: UpdateProductInput
  ): Promise<VendorProductRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (input.title !== undefined) {
      fields.push(`title = $${idx++}`);
      values.push(input.title);
    }
    if (input.slug !== undefined) {
      fields.push(`slug = $${idx++}`);
      values.push(input.slug);
    }
    if (input.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(input.description);
    }
    if (input.priceMinor !== undefined) {
      fields.push(`price_minor = $${idx++}`);
      values.push(input.priceMinor);
    }
    if (input.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(input.status);
    }
    if (input.categoryId !== undefined) {
      fields.push(`category_id = $${idx++}`);
      values.push(input.categoryId);
    }

    if (fields.length === 0) {
      return this.getProductById(vendorId, productId);
    }

    fields.push(`updated_at = clock_timestamp()`);
    values.push(productId);
    values.push(vendorId);

    const res = await query<VendorProductRecord>(
      `UPDATE products
       SET ${fields.join(', ')}
       WHERE id = $${idx++} AND vendor_id = $${idx++}
       RETURNING *`,
      values
    );

    if (res.rows.length === 0) return null;

    const inv = await query<{ on_hand_qty: number; reserved_qty: number }>(
      `SELECT on_hand_qty, reserved_qty FROM inventory WHERE product_id = $1`,
      [productId]
    );

    return {
      ...res.rows[0],
      on_hand_qty: inv.rows[0]?.on_hand_qty ?? 0,
      reserved_qty: inv.rows[0]?.reserved_qty ?? 0,
    };
  }

  async getProductById(vendorId: string, productId: string): Promise<VendorProductRecord | null> {
    const res = await query<VendorProductRecord>(
      `SELECT p.*, COALESCE(i.on_hand_qty, 0) as on_hand_qty, COALESCE(i.reserved_qty, 0) as reserved_qty
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id
       WHERE p.id = $1 AND p.vendor_id = $2`,
      [productId, vendorId]
    );
    return res.rows[0] || null;
  }

  async updateInventory(
    vendorId: string,
    productId: string,
    onHandQty: number
  ): Promise<{ product_id: string; on_hand_qty: number; reserved_qty: number } | null> {
    // Zero-IDOR: First verify this product belongs to this vendor
    const prod = await this.getProductById(vendorId, productId);
    if (!prod) return null;

    const res = await query<{ product_id: string; on_hand_qty: number; reserved_qty: number }>(
      `UPDATE inventory
       SET on_hand_qty = $1, version = version + 1, updated_at = clock_timestamp()
       WHERE product_id = $2
       RETURNING product_id, on_hand_qty, reserved_qty`,
      [onHandQty, productId]
    );

    return res.rows[0] || null;
  }

  async listOrders(vendorId: string): Promise<VendorOrderRecord[]> {
    const ordersRes = await query<VendorOrderRecord>(
      `SELECT * FROM orders WHERE vendor_id = $1 ORDER BY created_at DESC`,
      [vendorId]
    );
    return ordersRes.rows;
  }

  async getOrderById(vendorId: string, orderId: string): Promise<VendorOrderRecord | null> {
    const ordRes = await query<VendorOrderRecord>(
      `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2`,
      [orderId, vendorId]
    );
    if (ordRes.rows.length === 0) return null;

    const order = ordRes.rows[0];
    const itemsRes = await query(
      `SELECT * FROM order_items WHERE order_id = $1`,
      [orderId]
    );
    order.items = itemsRes.rows;
    return order;
  }

  async updateOrderStatus(
    vendorId: string,
    orderId: string,
    newStatus: string
  ): Promise<VendorOrderRecord | null> {
    return await withTransaction(async (client) => {
      // 1. Lock and verify vendor ownership
      const ordRes = await client.query<VendorOrderRecord>(
        `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2 FOR UPDATE`,
        [orderId, vendorId]
      );
      if (ordRes.rows.length === 0) return null;

      const oldOrder = ordRes.rows[0];

      // 2. Update order status
      const updated = await client.query<VendorOrderRecord>(
        `UPDATE orders
         SET status = $1, updated_at = clock_timestamp()
         WHERE id = $2 AND vendor_id = $3
         RETURNING *`,
        [newStatus, orderId, vendorId]
      );

      // 3. Record order status history
      await client.query(
        `INSERT INTO order_status_history (
           order_id, old_status, new_status, actor_type, reason
         ) VALUES ($1, $2, $3, 'vendor', 'Vendor status transition')`,
        [orderId, oldOrder.status, newStatus]
      );

      return updated.rows[0];
    });
  }
}
