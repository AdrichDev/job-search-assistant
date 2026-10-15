import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { WORKSPACE_ROOT } from './paths.js';

/** The single `.env` shared by every workspace, at the repository root. */
export const DEFAULT_DOTENV_PATH = resolve(WORKSPACE_ROOT, '.env');

/**
 * Loads `.env` into `process.env` if the file exists.
 *
 * Uses Node's built-in loader rather than a dotenv dependency - the project
 * requires Node >= 20.6 anyway.
 *
 * Resolves against the workspace root, not the current working directory:
 * npm runs workspace scripts with the cwd set to the package directory, so a
 * relative path would look for `packages/core/.env` and silently find nothing.
 */
export function loadDotEnv(path = DEFAULT_DOTENV_PATH): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

const adzunaEnvSchema = z.object({
  ADZUNA_APP_ID: z.string().min(1, 'ADZUNA_APP_ID is empty'),
  ADZUNA_APP_KEY: z.string().min(1, 'ADZUNA_APP_KEY is empty'),
  ADZUNA_BASE_URL: z.string().url().optional(),
});

export interface AdzunaCredentials {
  readonly appId: string;
  readonly appKey: string;
  readonly baseUrl?: string;
}

/**
 * Validates Adzuna credentials at startup, before any request is attempted.
 *
 * Called only when the Adzuna source is actually selected, so the offline mode
 * never needs an API key.
 */
export function loadAdzunaCredentials(env: NodeJS.ProcessEnv = process.env): AdzunaCredentials {
  const parsed = adzunaEnvSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${String(issue.path[0] ?? 'env')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Adzuna credentials are missing or invalid.\n${details}\n\nCopy .env.example to .env and fill it in, or run with --source=fixture.`,
    );
  }

  const { ADZUNA_APP_ID, ADZUNA_APP_KEY, ADZUNA_BASE_URL } = parsed.data;
  return ADZUNA_BASE_URL === undefined
    ? { appId: ADZUNA_APP_ID, appKey: ADZUNA_APP_KEY }
    : { appId: ADZUNA_APP_ID, appKey: ADZUNA_APP_KEY, baseUrl: ADZUNA_BASE_URL };
}
