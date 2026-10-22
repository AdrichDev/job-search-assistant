#!/usr/bin/env node
/**
 * Starts the web app with the local settings of this machine.
 *
 * The web app reads only `process.env` (Next does not load the root `.env`), so
 * machine-specific paths such as the CV library folder used to have to be exported
 * in every new terminal. This script reads an OPTIONAL, git-ignored file,
 * two OPTIONAL, git-ignored files and passes their entries to the web process,
 * in this order of precedence: the shell, `data/dev-env.json` for machine paths,
 * and the repository-root `.env`, where `npm run google:consent` writes the
 * Google credentials for the CLI - so a credential never has to exist twice:
 *
 *   { "JOB_QUEUE_CV_LIBRARY_DIR": "D:/Mis documentos/CVs",
 *     "JOB_QUEUE_CV_MODELS_PATH": "<repo>/data/cv-models.json" }
 *
 * Rules:
 * - a missing file is fine: nothing is added;
 * - a variable already set in the shell wins over the file;
 * - only `JOB_QUEUE_*` and `GOOGLE_*` names are accepted, values must be strings;
 * - a file that is not valid JSON stops the start with a clear message instead of
 *   silently running without the settings.
 *
 * Usage: node scripts/run-web.mjs <dev|start>
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_NAME = /^(JOB_QUEUE|GOOGLE)_[A-Z0-9_]+$/;

/** Pure: the accepted `NAME=value` lines of a .env, quotes stripped, empties dropped. */
/** Pure: the accepted NAME=value lines of a .env, quotes stripped, empties dropped. */
export function parseDotEnv(text) {
  const found = {};
  if (typeof text !== 'string') {
    return found;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const name = match[1];
    const raw = match[2].trim();
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    if (!ALLOWED_NAME.test(name) || value === '') {
      continue;
    }
    found[name] = value;
  }
  return found;
}

/**
 * Pure: merges the accepted entries of every source under `baseEnv`, in order.
 * An earlier source always wins, so callers pass the most specific first.
 */
export function mergeLocalEnv(baseEnv, ...sources) {
  const merged = { ...baseEnv };
  const applied = [];
  const ignored = [];
  for (const parsed of sources) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    ignored.push('<root>');
    continue;
  }
  for (const [name, value] of Object.entries(parsed)) {
    const usable = ALLOWED_NAME.test(name) && typeof value === 'string' && value.trim() !== '';
    if (!usable) {
      ignored.push(name);
      continue;
    }
    const alreadySet = typeof merged[name] === 'string' && merged[name] !== '';
    if (alreadySet) {
      continue;
    }
    merged[name] = value;
    applied.push(name);
  }
  }
  return { env: merged, applied, ignored };
}

function main() {
  const mode = process.argv[2];
  if (mode !== 'dev' && mode !== 'start') {
    console.error('Usage: node scripts/run-web.mjs <dev|start>');
    process.exit(2);
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const file = resolve(root, 'data', 'dev-env.json');
  let parsed = {};
  if (existsSync(file)) {
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      console.error(
        'data/dev-env.json is not valid JSON, so the web app was not started. ' +
          'Fix it (use forward slashes in paths) or move it aside.',
      );
      process.exit(1);
    }
  }

  // The root .env is where `npm run google:consent` puts the Google
  // credentials. Reading it here is what stops the credentials having to exist
  // twice: before, a token in .env made the CLI work while the web app saw no
  // mail configuration at all.
  const dotEnvFile = resolve(root, '.env');
  const dotEnv = existsSync(dotEnvFile) ? parseDotEnv(readFileSync(dotEnvFile, 'utf8')) : {};

  // Precedence: the shell, then data/dev-env.json, then .env.
  const { env, applied, ignored } = mergeLocalEnv(process.env, parsed, dotEnv);
  if (applied.length > 0) {
    // Names only: values can be personal paths or credentials.
    console.log(
      `[web] local settings applied (shell > data/dev-env.json > .env): ${applied.join(', ')}`,
    );
  }
  if (ignored.length > 0) {
    console.warn(`[web] ignored entries in data/dev-env.json: ${ignored.join(', ')}`);
  }

  const child = spawn('npm', ['run', mode, '--workspace', '@job-queue/web'], {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: true,
  });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
