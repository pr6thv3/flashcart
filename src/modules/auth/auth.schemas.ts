import { z } from 'zod';

export const registerSchema = z
  .object({
    email: z.string().email().max(255).toLowerCase().trim(),
    password: z.string().min(8).max(128),
    fullName: z.string().max(150).trim().optional(),
    full_name: z.string().max(150).trim().optional(),
    phoneNumber: z.string().max(30).optional(),
    phone_number: z.string().max(30).optional(),
  })
  .refine(
    (data) => {
      const name = (data.fullName || data.full_name || '').trim();
      return name.length >= 2;
    },
    {
      message: 'Full name is required (min 2 characters)',
      path: ['fullName'],
    }
  )
  .transform((data) => ({
    email: data.email,
    password: data.password,
    fullName: (data.fullName || data.full_name || '').trim(),
    phoneNumber: data.phoneNumber || data.phone_number,
  }));

export const loginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

