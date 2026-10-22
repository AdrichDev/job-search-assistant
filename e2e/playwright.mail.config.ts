import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import base from './playwright.config.js';
import { ISOLATION_ENV, PIPELINE_ENV } from './support/workspace.js';

/**
 * The mail round-trip suite: the same application and the same harness, one
 * difference - the server runs with the deterministic FAKE Gmail reader.
 *
 * Why a second config and not an env var on the main suite: arming fake mail for
 * the whole suite changes every page (`mailConfigured()` becomes true, the mail
 * section appears on /seguimiento, the catch-up component starts firing and a
 * "Correo revisado." notice lands in `role="status"`), which is exactly the kind
 * of cross-spec leakage that made twelve tracking specs fail once already. The
 * fake arm lives here, on its own surface, with its own server and its own port.
 *
 * Run it with `npm run test:e2e:mail`. It is not part of `npm run test:e2e`
 * because it needs a second build and a second server.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '..');

const MAIL_PORT = 3179;
const BASE_URL = `http://127.0.0.1:${MAIL_PORT}`;

export default {
  ...base,
  testDir: './specs-mail',
  outputDir: './.tmp/test-results-mail',
  use: { ...base.use, baseURL: BASE_URL },
  webServer: {
    command: `npm run build && npm run start --workspace @job-queue/web -- --port ${MAIL_PORT} --hostname 127.0.0.1`,
    cwd: WORKSPACE_ROOT,
    url: BASE_URL,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
    env: {
      ...ISOLATION_ENV,
      ...PIPELINE_ENV,
      NODE_ENV: 'production',
      // The fake arm, only here. `proposal` answers ONE message that reads as a
      // rejection and names the company the matcher must bind it to.
      JOB_QUEUE_WEB_MAIL: 'fake',
      JOB_QUEUE_WEB_MAIL_FAKE: 'proposal',
      JOB_QUEUE_WEB_MAIL_FAKE_COMPANY: 'Acme Sistemas',
    },
  },
};
