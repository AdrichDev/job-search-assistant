import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { CvVariant } from '../domain/job.js';
import { WORKSPACE_ROOT } from './paths.js';

/**
 * The candidate this pipeline ranks for.
 *
 * Kept as typed data, not prose, so the future CV/cover-letter tailoring slice
 * can consume the same object without re-deriving anything.
 */
export interface CandidateProfile {
  readonly displayName: string;
  readonly baseCity: string;
  readonly commuteRadius: string;
  readonly englishLevel: 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  readonly seekingLevel: 'junior';
  readonly hasDrivingLicence: boolean;
  readonly cvVariants: readonly CvVariant[];
  readonly headline: string;
}

const candidateProfileSchema = z.object({
  displayName: z.string().trim().min(1),
  baseCity: z.string().trim().min(1),
  commuteRadius: z.string().trim().min(1),
  englishLevel: z.enum(['A2', 'B1', 'B2', 'C1', 'C2']),
  seekingLevel: z.literal('junior'),
  hasDrivingLicence: z.boolean(),
  cvVariants: z.array(z.enum(['frontend', 'microsoft', 'general'])).min(1),
  headline: z.string().trim().min(1),
});

const candidateProfileOverrideSchema = candidateProfileSchema.partial().strict();

/** Safe, fictional defaults suitable for a public checkout. */
export const CANDIDATE_PROFILE: CandidateProfile = {
  displayName: 'Alex Example',
  baseCity: 'Madrid',
  commuteRadius: 'Madrid metropolitan area',
  englishLevel: 'B1',
  seekingLevel: 'junior',
  hasDrivingLicence: false,
  cvVariants: ['frontend', 'microsoft', 'general'],
  headline: 'Junior software developer seeking an entry-level role.',
};

/** Local personal configuration; ignored by Git. Copy the committed example to start. */
export const DEFAULT_CANDIDATE_PROFILE_PATH = resolve(
  WORKSPACE_ROOT,
  'candidate-profile.local.json',
);

/**
 * Loads an optional, validated partial profile from the local checkout.
 *
 * Missing local configuration uses the safe public defaults. Present but
 * malformed configuration fails fast so the queue is never produced for a
 * silently different candidate.
 */
export function loadCandidateProfile(
  path = DEFAULT_CANDIDATE_PROFILE_PATH,
): CandidateProfile {
  if (!existsSync(path)) {
    return CANDIDATE_PROFILE;
  }

  try {
    const override = candidateProfileOverrideSchema.parse(
      JSON.parse(readFileSync(path, 'utf8')) as unknown,
    );
    return candidateProfileSchema.parse({ ...CANDIDATE_PROFILE, ...override });
  } catch (cause: unknown) {
    const details = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid candidate profile at ${path}: ${details}`, { cause });
  }
}
