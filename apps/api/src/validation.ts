import { z } from 'zod';

export const neighborQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const pathQuerySchema = z.object({
  source: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(200),
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
