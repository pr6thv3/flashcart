import { z } from 'zod';

export const createProductSchema = z.object({
  title: z.string().min(1).max(255).trim(),
  slug: z.string().min(1).max(255).trim(),
  sku: z.string().min(1).max(100).trim(),
  description: z.string().min(1),
  priceMinor: z.number().int().positive(),
  currency: z.string().length(3).default('INR'),
  categoryId: z.string().uuid().optional(),
  initialStock: z.number().int().min(0).default(0),
  status: z.enum(['draft', 'published', 'archived']).default('published'),
});

export const updateProductSchema = z.object({
  title: z.string().min(1).max(255).trim().optional(),
  slug: z.string().min(1).max(255).trim().optional(),
  description: z.string().optional(),
  priceMinor: z.number().int().positive().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

export const updateInventorySchema = z.object({
  onHandQty: z.number().int().min(0),
});

export const fulfillOrderSchema = z.object({
  status: z.enum(['processing', 'shipped', 'delivered']).default('shipped'),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateInventoryInput = z.infer<typeof updateInventorySchema>;
export type FulfillOrderInput = z.infer<typeof fulfillOrderSchema>;
