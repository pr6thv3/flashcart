import { z } from 'zod';

export const checkoutItemSchema = z.object({
  productId: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  flashSaleId: z.string().uuid().optional(),
  flash_sale_id: z.string().uuid().optional(),
  quantity: z.number().int().positive().default(1),
});

export const createCheckoutSchema = z.object({
  cartId: z.string().uuid().optional(),
  cart_id: z.string().uuid().optional(),
  shippingAddressId: z.string().uuid().optional(),
  shipping_address_id: z.string().uuid().optional(),
  items: z.array(checkoutItemSchema).optional(),
  // Direct shorthand support
  productId: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  flashSaleId: z.string().uuid().optional(),
  flash_sale_id: z.string().uuid().optional(),
  quantity: z.number().int().positive().optional(),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;
export type CheckoutItemInput = z.infer<typeof checkoutItemSchema>;
