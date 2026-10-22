import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeLocalEnv, parseDotEnv } from './run-web.mjs';

test('adds an accepted entry that the shell did not set', () => {
  const { env, applied } = mergeLocalEnv({}, { JOB_QUEUE_CV_LIBRARY_DIR: 'D:/cv' });
  assert.equal(env.JOB_QUEUE_CV_LIBRARY_DIR, 'D:/cv');
  assert.deepEqual(applied, ['JOB_QUEUE_CV_LIBRARY_DIR']);
});

test('a variable already set in the shell wins over the file', () => {
  const { env, applied } = mergeLocalEnv(
    { JOB_QUEUE_CV_LIBRARY_DIR: 'C:/shell' },
    { JOB_QUEUE_CV_LIBRARY_DIR: 'D:/file' },
  );
  assert.equal(env.JOB_QUEUE_CV_LIBRARY_DIR, 'C:/shell');
  assert.deepEqual(applied, []);
});

test('only JOB_QUEUE_* and GOOGLE_* names with non-empty string values are accepted', () => {
  const { env, applied, ignored } = mergeLocalEnv(
    {},
    { PATH: 'x', NODE_OPTIONS: '--evil', JOB_QUEUE_A: 5, JOB_QUEUE_B: '  ', GOOGLE_REFRESH_TOKEN: 't' },
  );
  assert.deepEqual(applied, ['GOOGLE_REFRESH_TOKEN']);
  assert.deepEqual(ignored.sort(), ['JOB_QUEUE_A', 'JOB_QUEUE_B', 'NODE_OPTIONS', 'PATH']);
  assert.equal(env.PATH, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test('a non-object file changes nothing and does not throw', () => {
  for (const bad of [null, 'text', 7, ['JOB_QUEUE_X']]) {
    const base = { KEEP: '1' };
    const { env, applied, ignored } = mergeLocalEnv(base, bad);
    assert.deepEqual(env, base);
    assert.deepEqual(applied, []);
    assert.deepEqual(ignored, ['<root>']);
  }
});

test('does not mutate the base environment', () => {
  const base = {};
  mergeLocalEnv(base, { JOB_QUEUE_X: 'y' });
  assert.deepEqual(base, {});
});

test('parses the root .env: comments, blanks, quotes, and only accepted names', () => {
  const text = [
    '# Gmail read-only OAuth client (Google Cloud, type: desktop app). Never commit real values.',
    '',
    'GOOGLE_CLIENT_ID=abc-123',
    'GOOGLE_CLIENT_SECRET="s3cr3t"',
    "GOOGLE_REFRESH_TOKEN='1//token'",
    'GOOGLE_EMPTY=',
    'PATH=/evil',
    'not a line at all',
  ].join('\n');

  assert.deepEqual(parseDotEnv(text), {
    GOOGLE_CLIENT_ID: 'abc-123',
    GOOGLE_CLIENT_SECRET: 's3cr3t',
    GOOGLE_REFRESH_TOKEN: '1//token',
  });
});

test('a later source never overrides an earlier one, and the shell wins over both', () => {
  const { env, applied } = mergeLocalEnv(
    {},
    { JOB_QUEUE_CV_LIBRARY_DIR: 'D:/json' },
    { JOB_QUEUE_CV_LIBRARY_DIR: 'D:/dotenv', GOOGLE_CLIENT_ID: 'from-dotenv' },
  );
  assert.equal(env.JOB_QUEUE_CV_LIBRARY_DIR, 'D:/json');
  assert.equal(env.GOOGLE_CLIENT_ID, 'from-dotenv');
  assert.deepEqual(applied, ['JOB_QUEUE_CV_LIBRARY_DIR', 'GOOGLE_CLIENT_ID']);

  const shell = mergeLocalEnv(
    { GOOGLE_CLIENT_ID: 'from-shell' },
    {},
    { GOOGLE_CLIENT_ID: 'from-dotenv' },
  );
  assert.equal(shell.env.GOOGLE_CLIENT_ID, 'from-shell');
  assert.deepEqual(shell.applied, []);
});
