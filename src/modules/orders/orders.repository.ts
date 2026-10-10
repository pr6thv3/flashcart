import { query } from '../../db/pool.js';

export interface CustomerOrderSummary {
  id: string;
  checkout_id: string;
  order_number: string;
  status: string;
  currency: string;
  subtotal_minor: number;
  shipping_minor: number;
  tax_minor: number;
  total_minor: number;
  shipping_address_snapshot: any;
  created_at: string;
  updated_at: string;
  vendor: {
    id: string;
    store_name: string;
  };
  items: Array<{
    id: string;
    product_id: string;
    title: string;
    sku: string;
    quantity: number;
    unit_price_minor: number;
    total_minor: number;
  }>;
}

export class OrdersRepository {
  async listOrdersByCustomer(customerId: string): Promise<CustomerOrderSummary[]> {
    const ordersRes = await query<any>(
      `SELECT o.id, o.checkout_id, o.order_number, o.status, o.currency,
              o.subtotal_minor, o.shipping_minor, o.tax_minor, o.total_minor,
              o.shipping_address_snapshot, o.created_at, o.updated_at,
              vp.id as vendor_id, vp.store_name as vendor_store_name
       FROM orders o
       JOIN vendor_profiles vp ON vp.id = o.vendor_id
       WHERE o.customer_id = $1
       ORDER BY o.created_at DESC`,
      [customerId]
    );

    if (ordersRes.rows.length === 0) {
      return [];
    }

    const orderIds = ordersRes.rows.map((r) => r.id);
    const itemsRes = await query<any>(
      `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.unit_price_minor, oi.total_minor,
              p.title, p.sku
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = ANY($1::uuid[])`,
      [orderIds]
    );

    const itemsByOrder = new Map<string, any[]>();
    for (const item of itemsRes.rows) {
      const list = itemsByOrder.get(item.order_id) || [];
      list.push({
        id: item.id,
        product_id: item.product_id,
        title: item.title,
        sku: item.sku,
        quantity: Number(item.quantity),
        unit_price_minor: Number(item.unit_price_minor),
        total_minor: Number(item.total_minor),
      });
      itemsByOrder.set(item.order_id, list);
    }

    return ordersRes.rows.map((row) => ({
      id: row.id,
      checkout_id: row.checkout_id,
      order_number: row.order_number,
      status: row.status,
      currency: row.currency,
      subtotal_minor: Number(row.subtotal_minor),
      shipping_minor: Number(row.shipping_minor),
      tax_minor: Number(row.tax_minor),
      total_minor: Number(row.total_minor),
      shipping_address_snapshot: row.shipping_address_snapshot,
      created_at: row.created_at,
      updated_at: row.updated_at,
      vendor: {
        id: row.vendor_id,
        store_name: row.vendor_store_name,
      },
      items: itemsByOrder.get(row.id) || [],
    }));
  }

  async getOrderById(customerId: string, orderId: string): Promise<CustomerOrderSummary | null> {
    const ordersRes = await query<any>(
      `SELECT o.id, o.checkout_id, o.order_number, o.status, o.currency,
              o.subtotal_minor, o.shipping_minor, o.tax_minor, o.total_minor,
              o.shipping_address_snapshot, o.created_at, o.updated_at,
              vp.id as vendor_id, vp.store_name as vendor_store_name
       FROM orders o
       JOIN vendor_profiles vp ON vp.id = o.vendor_id
       WHERE o.id = $1 AND o.customer_id = $2`,
      [orderId, customerId]
    );

    if (ordersRes.rows.length === 0) {
      return null;
    }

    const row = ordersRes.rows[0];
    const itemsRes = await query<any>(
      `SELECT oi.id, oi.order_id, oi.product_id, oi.quantity, oi.unit_price_minor, oi.total_minor,
              p.title, p.sku
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    return {
      id: row.id,
      checkout_id: row.checkout_id,
      order_number: row.order_number,
      status: row.status,
      currency: row.currency,
      subtotal_minor: Number(row.subtotal_minor),
      shipping_minor: Number(row.shipping_minor),
      tax_minor: Number(row.tax_minor),
      total_minor: Number(row.total_minor),
      shipping_address_snapshot: row.shipping_address_snapshot,
      created_at: row.created_at,
      updated_at: row.updated_at,
      vendor: {
        id: row.vendor_id,
        store_name: row.vendor_store_name,
      },
      items: itemsRes.rows.map((item) => ({
        id: item.id,
        product_id: item.product_id,
        title: item.title,
        sku: item.sku,
        quantity: Number(item.quantity),
        unit_price_minor: Number(item.unit_price_minor),
        total_minor: Number(item.total_minor),
      })),
    };
  }
}
