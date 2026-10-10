import { query } from '../../db/pool.js';

export interface CartItemDetails {
  id: string;
  cart_id: string;
  product_id: string;
  vendor_id: string;
  vendor_store_name: string;
  title: string;
  sku: string;
  regular_price_minor: number;
  unit_price_minor: number;
  quantity: number;
  line_total_minor: number;
  on_hand_qty: number;
  reserved_qty: number;
  available_qty: number;
  flash_sale_id: string | null;
  flash_sale_price_minor: number | null;
  flash_sale_available_qty: number | null;
}

export interface CartSummaryDTO {
  cart_id: string;
  items: CartItemDetails[];
  items_by_vendor: Array<{
    vendor_id: string;
    vendor_store_name: string;
    subtotal_minor: number;
    items: CartItemDetails[];
  }>;
  subtotal_minor: number;
  item_count: number;
}

export class CartRepository {
  async getOrCreateCart(userId: string): Promise<string> {
    const existing = await query<{ id: string }>(
      `SELECT id FROM carts WHERE user_id = $1`,
      [userId]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0].id;
    }

    const inserted = await query<{ id: string }>(
      `INSERT INTO carts (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = clock_timestamp()
       RETURNING id`,
      [userId]
    );
    return inserted.rows[0].id;
  }

  async getCartDetails(cartId: string): Promise<CartSummaryDTO> {
    const res = await query<any>(
      `SELECT ci.id, ci.cart_id, ci.product_id, ci.quantity,
              p.vendor_id, p.title, p.sku, p.price_minor as regular_price_minor,
              vp.store_name as vendor_store_name,
              COALESCE(i.on_hand_qty, 0) as on_hand_qty,
              COALESCE(i.reserved_qty, 0) as reserved_qty,
              fs.id as flash_sale_id,
              fs.sale_price_minor as flash_sale_price_minor,
              (fs.quantity_limit - (fs.quantity_reserved + fs.quantity_sold)) as flash_sale_available_qty
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       JOIN vendor_profiles vp ON vp.id = p.vendor_id
       LEFT JOIN inventory i ON i.product_id = p.id
       LEFT JOIN flash_sales fs ON fs.product_id = p.id
         AND fs.is_active = true
         AND fs.starts_at <= clock_timestamp()
         AND fs.ends_at > clock_timestamp()
       WHERE ci.cart_id = $1
       ORDER BY ci.created_at ASC`,
      [cartId]
    );

    const items: CartItemDetails[] = res.rows.map((row) => {
      const regularPrice = Number(row.regular_price_minor);
      const isFlashSale = row.flash_sale_id && Number(row.flash_sale_available_qty) > 0;
      const unitPrice = isFlashSale ? Number(row.flash_sale_price_minor) : regularPrice;
      const quantity = Number(row.quantity);

      return {
        id: row.id,
        cart_id: row.cart_id,
        product_id: row.product_id,
        vendor_id: row.vendor_id,
        vendor_store_name: row.vendor_store_name,
        title: row.title,
        sku: row.sku,
        regular_price_minor: regularPrice,
        unit_price_minor: unitPrice,
        quantity,
        line_total_minor: unitPrice * quantity,
        on_hand_qty: Number(row.on_hand_qty),
        reserved_qty: Number(row.reserved_qty),
        available_qty: Math.max(0, Number(row.on_hand_qty) - Number(row.reserved_qty)),
        flash_sale_id: isFlashSale ? row.flash_sale_id : null,
        flash_sale_price_minor: isFlashSale ? Number(row.flash_sale_price_minor) : null,
        flash_sale_available_qty: isFlashSale ? Number(row.flash_sale_available_qty) : null,
      };
    });

    // Group items by vendor
    const vendorMap = new Map<string, { vendor_id: string; vendor_store_name: string; items: CartItemDetails[] }>();
    let subtotalMinor = 0;
    let itemCount = 0;

    for (const item of items) {
      subtotalMinor += item.line_total_minor;
      itemCount += item.quantity;

      const group = vendorMap.get(item.vendor_id) || {
        vendor_id: item.vendor_id,
        vendor_store_name: item.vendor_store_name,
        items: [],
      };
      group.items.push(item);
      vendorMap.set(item.vendor_id, group);
    }

    const itemsByVendor = Array.from(vendorMap.values()).map((v) => ({
      vendor_id: v.vendor_id,
      vendor_store_name: v.vendor_store_name,
      subtotal_minor: v.items.reduce((acc, i) => acc + i.line_total_minor, 0),
      items: v.items,
    }));

    return {
      cart_id: cartId,
      items,
      items_by_vendor: itemsByVendor,
      subtotal_minor: subtotalMinor,
      item_count: itemCount,
    };
  }

  async upsertCartItem(cartId: string, productId: string, quantity: number): Promise<void> {
    await query(
      `INSERT INTO cart_items (cart_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = clock_timestamp()`,
      [cartId, productId, quantity]
    );
  }

  async updateCartItemQuantity(cartId: string, productId: string, quantity: number): Promise<void> {
    await query(
      `UPDATE cart_items
       SET quantity = $1, updated_at = clock_timestamp()
       WHERE cart_id = $2 AND product_id = $3`,
      [quantity, cartId, productId]
    );
  }

  async deleteCartItem(cartId: string, productId: string): Promise<void> {
    await query(
      `DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2`,
      [cartId, productId]
    );
  }

  async clearCart(cartId: string): Promise<void> {
    await query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);
  }
}
