import { z } from 'zod';

/**
 * Boundary validation for the Manfred payloads.
 *
 * Everything optional that can be, because this is a third party's shape and
 * the pipeline's job is to survive it changing. The only genuinely required
 * fields are the four without which a posting cannot exist at all: an id, a
 * title, the slug the sitemap is keyed by, and a timestamp to order by.
 */

/** `id` arrives as a number; every other layer treats external ids as strings. */
const externalId = z.union([z.string(), z.number()]).transform(String);

/**
 * Manfred writes "not disclosed" as `0`, not as `null` or an absent field.
 *
 * Passing that 0 through would put "€0" in front of the candidate as though an
 * employer had offered it. Anything that is not a positive finite number
 * becomes `null`, which is the shape `Job` already uses for "no figure".
 */
const optionalSalary = z
  .unknown()
  .transform((value) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null,
  );

export const manfredOfferSchema = z.object({
  id: externalId,
  position: z.string().min(1),
  slug: z.string().min(1),
  status: z.string().default(''),
  salaryFrom: optionalSalary,
  salaryTo: optionalSalary,
  currency: z.string().default(''),
  /** 0-100. Shown in the description because `Job` has no field for it. */
  remotePercentage: z.number().nullish(),
  /**
   * Short marketing bullets, e.g. "🏠 Híbrido". The list endpoint's ONLY prose,
   * and the fallback description when detail enrichment fails.
   */
  highlights: z.array(z.string()).default([]),
  /** Sometimes `[]`. See the adapter: an empty array stays an empty location. */
  locations: z.array(z.string()).default([]),
  offerLanguages: z.array(z.string()).default([]),
  updatedAt: z.string().min(1),
  company: z.object({ name: z.string().default('') }).default({ name: '' }),
  isFreelance: z.boolean().nullish(),
});

export type ManfredOffer = z.infer<typeof manfredOfferSchema>;

/** The list endpoint returns a bare array, not an envelope. */
export const manfredOffersSchema = z.array(z.unknown());

/**
 * The prose sections of a single offer.
 *
 * All optional: enrichment is a bonus, and an offer whose detail payload is
 * half-empty must still ship with whatever it did carry. Some fields are
 * strings and some are arrays of strings, which is why every one of them goes
 * through the same permissive union.
 */
const section = z.union([z.string(), z.array(z.string())]).nullish();

export const manfredOfferDetailSchema = z.object({
  introduction: section,
  responsibilities: section,
  whatWillYouDo: section,
  howWillYouDoIt: section,
  whatTheyAskFor: section,
  whatOffering: section,
  whereWillDoIt: section,
  whoWillDoItWith: section,
  techs: z
    .array(z.object({ name: z.string().default('') }).passthrough())
    .default([]),
  softSkills: z
    .array(z.object({ name: z.string().default('') }).passthrough())
    .default([]),
});

export type ManfredOfferDetail = z.infer<typeof manfredOfferDetailSchema>;
