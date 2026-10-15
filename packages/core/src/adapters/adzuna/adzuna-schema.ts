import { z } from 'zod';

/**
 * Adzuna's response shape, as far as this pipeline cares about it.
 *
 * Deliberately permissive on the fields we do not use (`.passthrough()` is not
 * needed because unknown keys are stripped by default) and strict on the five
 * fields we do: an offer without an id, a title or a URL is unusable.
 */
export const adzunaResultSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().min(1),
  description: z.string().default(''),
  created: z.string().min(1),
  redirect_url: z.string().url(),
  company: z.object({ display_name: z.string().default('') }).default({ display_name: '' }),
  location: z.object({ display_name: z.string().default('') }).default({ display_name: '' }),
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
  contract_type: z.string().nullish(),
});

export const adzunaEnvelopeSchema = z.object({
  results: z.array(z.unknown()),
  count: z.number().optional(),
});

export type AdzunaResult = z.infer<typeof adzunaResultSchema>;
export type AdzunaEnvelope = z.infer<typeof adzunaEnvelopeSchema>;
