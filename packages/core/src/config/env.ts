import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
