import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  GEMINI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['gemini', 'deepseek']).default('gemini'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  STORAGE_PATH: z.string().default('./storage'),
}).refine(v => v.GEMINI_API_KEY || v.DEEPSEEK_API_KEY, { message: 'GEMINI_API_KEY or DEEPSEEK_API_KEY required' });

export const env = envSchema.parse(process.env);
