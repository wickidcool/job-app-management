import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().default(3001),
  STORAGE_DIR: z.string().default('./data'),
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'stub']).optional(),
  AI_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-3-5-haiku-20241022'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
});

export const config = configSchema.parse(process.env);
export type Config = z.infer<typeof configSchema>;
