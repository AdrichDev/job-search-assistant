import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { DEFAULT_HISTORY_LOG_PATH, resolveDataPath } from '../../src/config/paths.js';

/**
 * The override seam that makes an isolated test run possible.
 *
 * Without it, anything that boots the real app - including a browser-driven
 * E2E suite - writes straight into the human's own `data/applications.json`.
 * A test suite that eats the user's application history is a worse defect than
 * any it could catch, so the seam is production code with its own tests, not a
 * test-only monkey patch.
 */
describe('resolveDataPath', () => {
  const fallback = resolve('/workspace/data/applications.json');

  it('uses the fallback when the variable is absent', () => {
    expect(resolveDataPath('ANY_VAR', fallback, {})).toBe(fallback);
  });

  it('uses the fallback when the variable is empty or blank', () => {
    expect(resolveDataPath('ANY_VAR', fallback, { ANY_VAR: '' })).toBe(fallback);
    expect(resolveDataPath('ANY_VAR', fallback, { ANY_VAR: '   ' })).toBe(fallback);
  });

  it('honours an absolute override', () => {
    const override = resolve('/tmp/run-1/applications.json');
    expect(resolveDataPath('ANY_VAR', fallback, { ANY_VAR: override })).toBe(override);
  });

  it('resolves a relative override against the current working directory', () => {
    expect(resolveDataPath('ANY_VAR', fallback, { ANY_VAR: './tmp/log.json' })).toBe(
      resolve('./tmp/log.json'),
    );
  });

  it('trims surrounding whitespace rather than producing a padded path', () => {
    const override = resolve('/tmp/run-2/queue.json');
    expect(resolveDataPath('ANY_VAR', fallback, { ANY_VAR: `  ${override}  ` })).toBe(override);
  });
});

describe('DEFAULT_HISTORY_LOG_PATH', () => {
  it('lives beside the other personal logs under data/ unless overridden', () => {
    // The e2e suite sets JOB_QUEUE_HISTORY_PATH for its own process; unit tests do not.
    if (process.env['JOB_QUEUE_HISTORY_PATH'] === undefined) {
      expect(DEFAULT_HISTORY_LOG_PATH.split(String.fromCharCode(92)).join('/')).toMatch(/\/data\/application-history\.json$/);
    }
  });

  it('honours the JOB_QUEUE_HISTORY_PATH override seam', () => {
    const override = resolve('/tmp/run-3/history.json');
    expect(
      resolveDataPath('JOB_QUEUE_HISTORY_PATH', resolve('/workspace/data/application-history.json'), {
        JOB_QUEUE_HISTORY_PATH: override,
      }),
    ).toBe(override);
  });
});

describe('CV library locations', () => {
  it('default to git-ignored locations under data/ unless overridden', async () => {
    const paths = await import('../../src/config/paths.js');
    const posix = (value: string) => value.split(String.fromCharCode(92)).join('/');
    if (process.env['JOB_QUEUE_CV_LIBRARY_DIR'] === undefined) {
      expect(posix(paths.DEFAULT_CV_LIBRARY_DIR)).toMatch(/\/data\/cv-library$/);
    }
    if (process.env['JOB_QUEUE_CV_MODELS_PATH'] === undefined) {
      expect(posix(paths.DEFAULT_CV_MODELS_PATH)).toMatch(/\/data\/cv-models\.json$/);
    }
  });

  it('honour their own environment variables', () => {
    const library = resolve('/somewhere/my-cvs');
    const registry = resolve('/somewhere/registry.json');
    expect(resolveDataPath('JOB_QUEUE_CV_LIBRARY_DIR', 'x', { JOB_QUEUE_CV_LIBRARY_DIR: library })).toBe(library);
    expect(resolveDataPath('JOB_QUEUE_CV_MODELS_PATH', 'x', { JOB_QUEUE_CV_MODELS_PATH: registry })).toBe(registry);
  });
});

describe('DEFAULT_MAIL_RUN_STATE_PATH', () => {
  it('lives under data/ as a dot file unless overridden', async () => {
    const paths = await import('../../src/config/paths.js');
    if (process.env['JOB_QUEUE_MAIL_RUN_STATE_PATH'] === undefined) {
      expect(paths.DEFAULT_MAIL_RUN_STATE_PATH.split(String.fromCharCode(92)).join('/')).toMatch(
        /\/data\/\.mail-run\.json$/,
      );
    }
  });

  it('honours the JOB_QUEUE_MAIL_RUN_STATE_PATH override seam', () => {
    const override = resolve('/tmp/run-4/mail-run.json');
    expect(
      resolveDataPath('JOB_QUEUE_MAIL_RUN_STATE_PATH', resolve('/workspace/data/.mail-run.json'), {
        JOB_QUEUE_MAIL_RUN_STATE_PATH: override,
      }),
    ).toBe(override);
  });
});

describe('DEFAULT_MAIL_PROPOSALS_PATH', () => {
  it('lives under data/ unless overridden', async () => {
    const paths = await import('../../src/config/paths.js');
    if (process.env['JOB_QUEUE_MAIL_PROPOSALS_PATH'] === undefined) {
      expect(paths.DEFAULT_MAIL_PROPOSALS_PATH.split(String.fromCharCode(92)).join('/')).toMatch(
        /\/data\/mail-proposals\.json$/,
      );
    }
  });

  it('honours the JOB_QUEUE_MAIL_PROPOSALS_PATH override seam', () => {
    const override = resolve('/tmp/run-5/mail-proposals.json');
    expect(
      resolveDataPath('JOB_QUEUE_MAIL_PROPOSALS_PATH', resolve('/workspace/data/mail-proposals.json'), {
        JOB_QUEUE_MAIL_PROPOSALS_PATH: override,
      }),
    ).toBe(override);
  });
});
