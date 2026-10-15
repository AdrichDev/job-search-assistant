import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ISOLATION_ENV, PIPELINE_ENV } from './support/workspace.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(HERE, '..');

/**
 * Port chosen away from 3000 so a `npm run dev` the user left open is neither
 * clobbered nor accidentally used as the system under test.
 */
const PORT = 3178;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './specs',
  outputDir: './.tmp/test-results',

  /*
   * Serial, one worker, on purpose.
   *
   * The system under test is a single server process whose state is two files
   * on disk. Parallel workers would seed each other's queue mid-render and the
   * suite would flake for reasons unrelated to the app. This is a handful of
   * high-value journeys, not a matrix - the wall-clock cost is seconds.
   */
  workers: 1,
  fullyParallel: false,

  /*
   * No retries. A retry on a suite this small converts a real intermittent
   * defect into a green tick, which is exactly the class of blindness that let
   * thirteen dead buttons ship.
   */
  retries: 0,

  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * Builds and starts the REAL application, then tears it down.
   *
   * `npm run build` compiles core and runs `next build`; `next start` serves
   * the production output. Not `next dev`: dev-mode React logs and on-demand
   * compilation would make both the console-error assertion and the timings
   * meaningless.
   *
   * `env` is where isolation actually happens, and it now carries two separate
   * guarantees.
   *
   * `ISOLATION_ENV` is read by `resolveDataPath` in @job-queue/core, inside the
   * server process, so every read and every write the app performs during the
   * suite lands in `.tmp/`. Without it this suite would edit the user's real
   * application history and dismissals.
   *
   * `PIPELINE_ENV` points the fetch button at the committed offline catalogue.
   * Without it, a spec that presses "Buscar ofertas" would put ~137 real HTTP
   * requests on employers' servers - which this project does not do, and
   * certainly not from a test.
   */
  webServer: {
    command: `npm run build && npm run start --workspace @job-queue/web -- --port ${PORT} --hostname 127.0.0.1`,
    cwd: WORKSPACE_ROOT,
    url: BASE_URL,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...ISOLATION_ENV, ...PIPELINE_ENV, NODE_ENV: 'production' },
  },

  globalSetup: './support/global-setup.ts',
});
