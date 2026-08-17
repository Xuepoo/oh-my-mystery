import { z } from 'zod';

export const neighborQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .regex(/^[01]:(?:0|[1-9]\d{0,18})$/)
    .refine((value) => {
      const id = value.slice(2);
      return id.length < 19 || id <= '9223372036854775807';
    })
    .optional(),
  direction: z.enum(['out', 'in', 'both']).default('both'),
  predicates: z
    .string()
    .max(500)
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.string().regex(/^[a-z0-9_:-]+$/i)).max(20))
    .optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const pathQuerySchema = z.object({
  source: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(200),
});

export const relationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(60).default(30),
  cursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

export const turnstileResponseSchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional(),
});

export function parseQuery<T extends z.ZodType>(
  schema: T,
  values: Record<string, string | undefined>,
) {
  const result = schema.safeParse(values);
  return result.success ? { data: result.data } : { error: 'Invalid query parameters' as const };
}
