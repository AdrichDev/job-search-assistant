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
