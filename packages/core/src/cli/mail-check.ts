import { consoleLogger } from '../adapters/logging/console-logger.js';
import { createGmailReader } from '../adapters/gmail/gmail-reader.js';
import { createJsonMailProposalRepository } from '../adapters/persistence/json-mail-proposal-repository.js';
import { createJsonMailRunStateStore } from '../adapters/persistence/json-mail-run-state-store.js';
import { createJsonApplicationRepository } from '../adapters/persistence/json-application-repository.js';
import type { MailCheckDeps } from '../app/check-mail-with-proposals.js';
import type { GmailReader } from '../ports/gmail-reader.js';
import {
  DEFAULT_APPLICATION_LOG_PATH,
  DEFAULT_MAIL_PROPOSALS_PATH,
  DEFAULT_MAIL_RUN_STATE_PATH,
} from '../config/paths.js';
import { loadDotEnv } from '../config/env.js';
import { MAIL_CHECK_USAGE, parseMailCheckArgs, runMailCheckCommand } from './mail-check-command.js';

/**
 * COMPOSITION ROOT for the scheduled mail check (`npm run mail:check`).
 *
 * Wiring, argument handling and printing only - the pipeline lives in
 * `checkMailWithProposals` and the output contract in `mail-check-command.ts`,
 * because this module calls `main()` at import time and is, by construction,
 * untestable. The web app's catch-up composes the same pieces in
 * `apps/web/src/server/mail.ts`; both must see the same behaviour.
 *
 * The root `.env` is the CLI's credential source (`google:consent` writes the
 * refresh token there); the web app gets its own values from `data/dev-env.json`.
 * A credential never reaches `console.log`: the command's lines carry variable
 * NAMES and paths, and anything unexpected goes to the logger.
 */

function googleValue(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw.trim().length === 0 ? undefined : raw.trim();
}

/**
 * Never called: `configured()` is false exactly when this is the reader in the
 * deps, and the pipeline returns `not_configured` before touching it. It exists
 * only so the deps type is satisfied without building the real reader.
 */
const unreachableReader: GmailReader = {
  fetchRecent: async () => ({ status: 'unavailable', reason: 'bad_response' }),
};

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseMailCheckArgs(argv);
  if (parsed.help) {
    console.log(MAIL_CHECK_USAGE);
    return 0;
  }
  if ('error' in parsed) {
    console.error(parsed.error);
    console.error('');
    console.error(MAIL_CHECK_USAGE);
    return 1;
  }

  loadDotEnv();

  const clientId = googleValue('GOOGLE_CLIENT_ID');
  const clientSecret = googleValue('GOOGLE_CLIENT_SECRET');
  const refreshToken = googleValue('GOOGLE_REFRESH_TOKEN');
  const configured =
    clientId !== undefined && clientSecret !== undefined && refreshToken !== undefined;

  const deps: MailCheckDeps = {
    configured: () => configured,
    reader: configured
      ? createGmailReader({
          clientId,
          clientSecret,
          refreshToken,
        })
      : unreachableReader,
    store: createJsonMailRunStateStore({ filePath: DEFAULT_MAIL_RUN_STATE_PATH }),
    proposals: createJsonMailProposalRepository({ filePath: DEFAULT_MAIL_PROPOSALS_PATH }),
    applications: createJsonApplicationRepository({ filePath: DEFAULT_APPLICATION_LOG_PATH }),
    now: () => new Date(),
    logger: consoleLogger,
  };

  const result = await runMailCheckCommand({
    deps,
    force: parsed.force,
    statePath: DEFAULT_MAIL_RUN_STATE_PATH,
  });

  console.log('');
  for (const line of result.lines) {
    console.log(line);
  }
  console.log('');
  return result.exitCode;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    consoleLogger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
