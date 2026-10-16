import 'server-only';

import {
  DEFAULT_BOARD_CONCURRENCY,
  DEFAULT_BOARD_TIMEOUT_MS,
  DEFAULT_FIXTURE_PATH,
  DEFAULT_LIVENESS_CACHE_PATH,
  DEFAULT_QUEUE_PATH,
  consoleLogger,
  createQueuePipelineRunner,
  parseSourceSelection,
  type PipelineRunner,
} from '@job-queue/core';

/**
 * Composition of the FETCH path, kept in its own module.
 *
 * This is the only place in the web app that can cause an outbound request, and
 * the only one whose sources may need a credential (a search provider reads its key from
 * the environment inside the core adapter). Isolating it keeps the promise made
 * in `container.ts` literally true - the render path loads nothing secret - and
 * gives anyone auditing "what can this server talk to?" one short file.
 *
 * `server-only`, so an accidental client import is a BUILD error. Nothing here
 * is ever bundled for the browser, and no value read here is returned to it:
 * the fetch server action hands back a run STATE, which contains counts and
 * error strings and no configuration at all.
 *
 * ## Why the knobs are environment variables
 *
 * The CLI already exposes every one of these as a flag. A button has no flags,
 * so the same choices are read from the environment - the pattern this codebase
 * already established in `config/paths.ts`, where the E2E suite relocates the
 * data files from outside the app rather than through a test-only code path.
 *
 * The defaults are the production ones: every real source, links resolved, links
 * checked. Nothing needs to be set for the button to do the right thing. The
 * E2E suite sets `JOB_QUEUE_WEB_SOURCES=fixture` and
 * `JOB_QUEUE_WEB_CHECK_LINKS=0`, which is not a stub of the pipeline - it is the
 * real pipeline, the real filters, the real write guard - restricted to the
 * offline catalogue so a browser test never touches an employer's server.
 */

/** Blank is treated as absent, exactly as `resolveDataPath` does. */
function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim().length === 0 ? undefined : raw.trim();
}

/**
 * A boolean knob that is ON unless explicitly turned off.
 *
 * Same precedence as the CLI's `--no-*` flags: the negative wins. Somebody who
 * typed the opt-out meant it, and silently sending requests a human asked us not
 * to send is not a defensible default.
 */
function readFlag(name: string, fallback: boolean): boolean {
  const raw = readEnv(name)?.toLowerCase();
  if (raw === undefined) {
    return fallback;
  }
  return !['0', 'false', 'no', 'off'].includes(raw);
}

function readNumber(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

let runner: PipelineRunner | null = null;

export function pipelineRunner(): PipelineRunner {
  runner ??= createQueuePipelineRunner({
    // `all` = every REAL source. The sample catalogue is never included in a
    // shortcut and may not share a run with a real source - see
    // `cli/source-selection.ts` for why that rule exists.
    sources: parseSourceSelection(readEnv('JOB_QUEUE_WEB_SOURCES') ?? 'all'),
    outputPath: DEFAULT_QUEUE_PATH,
    fixturePath: DEFAULT_FIXTURE_PATH,
    livenessCachePath: DEFAULT_LIVENESS_CACHE_PATH,
    checkLinks: readFlag('JOB_QUEUE_WEB_CHECK_LINKS', true),
    concurrency: readNumber('JOB_QUEUE_WEB_CONCURRENCY', DEFAULT_BOARD_CONCURRENCY),
    timeoutMs: readNumber('JOB_QUEUE_WEB_TIMEOUT_MS', DEFAULT_BOARD_TIMEOUT_MS),
    logger: consoleLogger,
    now: () => new Date(),
  });

  return runner;
}
