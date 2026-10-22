import {
  checkMailWithProposals,
  type MailCheckDeps,
  type MailCheckOutcome,
} from '../app/check-mail-with-proposals.js';

/**
 * The output contract of `mail:check`: one exit code and a handful of lines per
 * pipeline outcome.
 *
 * This module only RENDERS. Every gate and every ordering rule lives in
 * `checkMailWithProposals`, which the web app's catch-up shares; a wording
 * change here must never become a behaviour change the web app does not get.
 *
 * Lines name variable NAMES, paths that were handed in and commands to run -
 * never a credential value and never an underlying exception message, because
 * a scheduled task's output can end up in a log or a screenshot.
 */

export const MAIL_CHECK_USAGE = `Usage: npm run mail:check [-- --force]

Checks Gmail for replies about your applications and turns them into pending
proposals on /seguimiento. Run without flags it does nothing when the daily
schedule says nothing is due or when a retry cooldown still applies.

  --force   Run even when nothing is due or the cooldown applies.
  --help    Show this help.`;

export type ParsedMailCheckArgs =
  | { readonly help: true }
  | { readonly help: false; readonly force: boolean }
  | { readonly help: false; readonly force: false; readonly error: string };

export function parseMailCheckArgs(argv: readonly string[]): ParsedMailCheckArgs {
  let force = false;
  for (const arg of argv) {
    if (arg === '--force') {
      force = true;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else {
      // Only two flags exist; anything else is a typo the user must see, not
      // silently ignored input that changes what the run would have done.
      return {
        help: false,
        force: false,
        error: `Unknown argument: ${arg}. Only --force and --help exist.`,
      };
    }
  }
  return { help: false, force };
}

function notDueLine(): string {
  return 'Nothing to do: the last successful mail check is still current for today.';
}

function cooldownLine(): string {
  return 'Nothing to do: a previous attempt failed recently and the retry cooldown is still running.';
}

function alreadyRunningLine(): string {
  return 'Nothing to do: another mail check is already running.';
}

function notConfiguredLines(): readonly string[] {
  return [
    'Mail is not configured: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN must all be set in the repository-root .env. This command reads that file; data/dev-env.json is what the WEB app reads, not this one.',
    'Run npm run google:consent once in a browser session and approve read-only access to obtain the refresh token.',
  ];
}

function stateCorruptLines(statePath: string): readonly string[] {
  return [
    `The mail run state at ${statePath} is corrupt and was left untouched.`,
    'That file holds the date of the last successful check, so it is never reset automatically; fix or remove it by hand.',
  ];
}

function authExpiredLines(): readonly string[] {
  return [
    'The Google refresh token was rejected; it most likely expired.',
    'Run npm run google:consent in a browser session and approve read-only access once to get a new token.',
  ];
}

function unavailableLine(reason: string): string {
  return `Gmail could not be checked (${reason}); try again later.`;
}

function failedLine(): string {
  return 'The mail check failed unexpectedly; the technical detail is in the log and the next scheduled run will retry.';
}

function linesFor(
  outcome: MailCheckOutcome,
  proposed: number,
  statePath: string,
): readonly string[] {
  switch (outcome.status) {
    case 'ok':
      return [
        `Read ${outcome.messages.length} recent message${outcome.messages.length === 1 ? '' : 's'}.`,
        `Created ${proposed} pending proposal${proposed === 1 ? '' : 's'}.`,
        'A proposal changes nothing on its own: confirm or dismiss it on /seguimiento.',
      ];
    case 'not_due':
      return [notDueLine()];
    case 'cooldown':
      return [cooldownLine()];
    case 'already_running':
      return [alreadyRunningLine()];
    case 'not_configured':
      return notConfiguredLines();
    case 'state_corrupt':
      return stateCorruptLines(statePath);
    case 'auth_expired':
      return authExpiredLines();
    case 'unavailable':
      return [unavailableLine(outcome.reason)];
    case 'failed':
      return [failedLine()];
  }
}

/** `ok` and the three "nothing to do now" outcomes are a clean run. */
function exitCodeFor(outcome: MailCheckOutcome): 0 | 1 {
  return outcome.status === 'ok' ||
    outcome.status === 'not_due' ||
    outcome.status === 'cooldown' ||
    outcome.status === 'already_running'
    ? 0
    : 1;
}

export interface MailCheckCommandInput {
  readonly deps: MailCheckDeps;
  readonly force: boolean;
  readonly statePath: string;
}

export async function runMailCheckCommand(
  input: MailCheckCommandInput,
): Promise<{ readonly exitCode: 0 | 1; readonly lines: readonly string[] }> {
  const result = await checkMailWithProposals(input.deps, { force: input.force });
  return {
    exitCode: exitCodeFor(result.outcome),
    lines: linesFor(result.outcome, result.proposed, input.statePath),
  };
}
