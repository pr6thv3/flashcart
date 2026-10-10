export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: any;

  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('flashcart_token');
}

export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('flashcart_token', token);
  } else {
    localStorage.removeItem('flashcart_token');
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit & { idempotencyKey?: string } = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const token = getStoredToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // sends cookies
  });

  const contentType = response.headers.get('content-type');
  let data: any = null;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorCode = data?.error?.code || `HTTP_${response.status}`;
    const errorMessage =
      data?.error?.message || (typeof data === 'string' ? data : 'An unexpected error occurred');
    throw new ApiError(response.status, errorCode, errorMessage, data?.error);
  }

  return data as T;
}

// Currency formatting utility
export function formatPrice(minorUnits: number | null | undefined, currency: string = 'INR'): string {
  if (minorUnits === null || minorUnits === undefined) return '₹0.00';
  const major = minorUnits / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}

// Product Types
export interface Product {
  id: string;
  vendor_id: string;
  vendor_store_name?: string;
  category_id?: string;
  title: string;
  slug: string;
  sku: string;
  description: string;
  price_minor: number;
  currency: string;
  status: string;
  on_hand_qty: number;
  reserved_qty: number;
  available_qty: number;
  created_at: string;
}

// Flash Sale Types
export interface FlashSale {
  id: string;
  product_id: string;
  product_title?: string;
  product_description?: string;
  sale_price_minor: number;
  currency: string;
  quantity_limit: number;
  quantity_reserved: number;
  quantity_sold: number;
  available_sale_qty: number;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
  product?: Product;
}

// Cart Types
export interface CartItem {
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

export interface CartVendorGroup {
  vendor_id: string;
  vendor_store_name: string;
  subtotal_minor: number;
  items: CartItem[];
}

export interface CartDetails {
  cart_id: string;
  items: CartItem[];
  items_by_vendor: CartVendorGroup[];
  subtotal_minor: number;
  item_count: number;
}

// Checkout & Order Types
export interface CheckoutResult {
  checkoutId: string;
  reservationId: string;
  reservation_id: string;
  status: string;
  currency: string;
  totalMinor: number;
  total_minor: number;
  totalCents: number;
  total_cents: number;
  expiresAt: string;
  expires_at: string;
  orders: Array<{
    orderId: string;
    orderNumber: string;
    vendorId: string;
    status: string;
    totalMinor: number;
  }>;
}

export interface CustomerOrder {
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

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  roles: string[];
}

// API methods object
export const api = {
  // Auth
  auth: {
    register: (data: { email: string; password: string; full_name?: string }) =>
      apiRequest<{ user: UserProfile; token: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    login: (data: { email: string; password: string }) =>
      apiRequest<{ user: UserProfile; token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    logout: () =>
      apiRequest('/auth/logout', {
        method: 'POST',
      }),
    me: () =>
      apiRequest<{ user: UserProfile }>('/auth/me', {
        method: 'GET',
      }),
  },

  // Catalog & Flash sales
  catalog: {
    getProducts: () => apiRequest<Product[]>('/products'),
    getProduct: (id: string) => apiRequest<Product>(`/products/${id}`),
    getActiveFlashSales: () => apiRequest<FlashSale[]>('/flash-sales/active'),
    getFlashSale: (id: string) => apiRequest<FlashSale>(`/flash-sales/${id}`),
  },

  // Cart
  cart: {
    getCart: () => apiRequest<CartDetails>('/cart'),
    addItem: (productId: string, quantity: number = 1) =>
      apiRequest<CartDetails>('/cart/items', {
        method: 'POST',
        body: JSON.stringify({ productId, quantity }),
      }),
    updateItem: (productId: string, quantity: number) =>
      apiRequest<CartDetails>(`/cart/items/${productId}`, {
        method: 'PUT',
        body: JSON.stringify({ quantity }),
      }),
    removeItem: (productId: string) =>
      apiRequest<CartDetails>(`/cart/items/${productId}`, {
        method: 'DELETE',
      }),
    clearCart: () =>
      apiRequest('/cart', {
        method: 'DELETE',
      }),
  },

  // Checkout
  checkout: {
    reserve: (
      payload: {
        cartId?: string;
        flashSaleId?: string;
        productId?: string;
        quantity?: number;
        items?: Array<{ productId?: string; flashSaleId?: string; quantity: number }>;
        shippingAddressId?: string;
      },
      idempotencyKey: string
    ) =>
      apiRequest<CheckoutResult>('/checkout/reserve', {
        method: 'POST',
        body: JSON.stringify(payload),
        idempotencyKey,
      }),
    getCheckout: (id: string) => apiRequest<any>(`/checkout/${id}`),
  },

  // Payments
  payment: {
    pay: (payload: {
      checkoutId: string;
      reservationId?: string;
      simulateStatus: 'success' | 'failure' | 'timeout';
      paymentMethod?: string;
      testCardToken?: string;
    }) =>
      apiRequest<any>('/checkout/pay', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },

  // Customer Orders
  orders: {
    list: () => apiRequest<CustomerOrder[]>('/orders'),
    get: (id: string) => apiRequest<CustomerOrder>(`/orders/${id}`),
  },

  // Vendor Portal
  vendor: {
    getProfile: () => apiRequest<any>('/vendor/profile'),
    getProducts: () => apiRequest<any[]>('/vendor/products'),
    createProduct: (data: {
      title: string;
      description?: string;
      priceMinor: number;
      sku: string;
      initialOnHandQty?: number;
    }) =>
      apiRequest<any>('/vendor/products', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateProduct: (id: string, data: any) =>
      apiRequest<any>(`/vendor/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateInventory: (productId: string, onHandQty: number) =>
      apiRequest<any>(`/vendor/inventory/${productId}`, {
        method: 'PUT',
        body: JSON.stringify({ onHandQty }),
      }),
    getOrders: () => apiRequest<any[]>('/vendor/orders'),
    getOrder: (id: string) => apiRequest<any>(`/vendor/orders/${id}`),
    fulfillOrder: (orderId: string, carrier: string = 'Standard Express', trackingNumber?: string) =>
      apiRequest<any>(`/vendor/orders/${orderId}/fulfill`, {
        method: 'PUT',
        body: JSON.stringify({ carrier, trackingNumber: trackingNumber || `TRK-${Date.now()}` }),
      }),
  },
};
