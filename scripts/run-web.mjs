#!/usr/bin/env node
/**
 * Starts the web app with the local settings of this machine.
 *
 * The web app reads only `process.env` (Next does not load the root `.env`), so
 * machine-specific paths such as the CV library folder used to have to be exported
 * in every new terminal. This script reads an OPTIONAL, git-ignored file,
 * `data/dev-env.json`, and passes its entries to the web process:
 *
 *   { "JOB_QUEUE_CV_LIBRARY_DIR": "D:/Adrian/3. Curriculum",
 *     "JOB_QUEUE_CV_MODELS_PATH": "D:/Adrian/22. Proyectos/job-search-assistant/data/cv-models.json" }
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

/** Pure: merges the accepted entries of `parsed` under `baseEnv`. Never throws. */
export function mergeLocalEnv(baseEnv, parsed) {
  const merged = { ...baseEnv };
  const applied = [];
  const ignored = [];
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { env: merged, applied, ignored: ['<root>'] };
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

  const { env, applied, ignored } = mergeLocalEnv(process.env, parsed);
  if (applied.length > 0) {
    // Names only: values can be personal paths or credentials.
    console.log(`[web] local settings from data/dev-env.json: ${applied.join(', ')}`);
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
