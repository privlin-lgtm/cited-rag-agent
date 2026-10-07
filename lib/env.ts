import { z } from 'zod';
import { usdPerMTok } from './pricing';

export const appEnv = z.enum(['local', 'sandbox', 'qa', 'production']).default('local');

const schema = z.object({
  DATABASE_URL: z.url(),
  VOYAGE_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z
    .string()
    .refine((model) => Object.hasOwn(usdPerMTok, model), 'must be a key of lib/pricing.ts')
    .default('claude-sonnet-5-5'),
  DAILY_ANTHROPIC_BUDGET_USD: z.coerce.number().positive().default(1),
  IP_HASH_SECRET: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  APP_ENV: appEnv,
});

export const parseEnv = (source: Record<string, string | undefined>) => schema.parse(source);

let parsed: ReturnType<typeof parseEnv> | undefined;

export const env = () => (parsed ??= parseEnv(process.env));
