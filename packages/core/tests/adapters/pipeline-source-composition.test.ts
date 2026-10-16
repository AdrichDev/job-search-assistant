import { describe, expect, it } from 'vitest';
import {
  buildLinkChecker,
  buildSourceFactories,
  type SourceCompositionOptions,
} from '../../src/adapters/pipeline/source-composition.js';
import { SELECTABLE_SOURCE_IDS } from '../../src/cli/source-selection.js';
import { silentLogger } from '../helpers/silent-logger.js';

const OPTIONS: SourceCompositionOptions = {
  fixturePath: 'unused-fixture.json',
  livenessCachePath: 'unused-liveness.json',
  checkLinks: false,
  concurrency: 1,
  timeoutMs: 1000,
  logger: silentLogger,
  now: () => new Date('2026-01-01T00:00:00.000Z'),
};

describe('shared source composition', () => {
  it('offers one factory for every selectable source id', () => {
    const factories = buildSourceFactories(OPTIONS);
    expect(Object.keys(factories).sort()).toEqual([...SELECTABLE_SOURCE_IDS].sort());
  });

  it('builds the fixture source under its own id without touching the network', () => {
    expect(buildSourceFactories(OPTIONS).fixture().id).toBe('fixture');
  });

  it('returns no checker at all, not a do-nothing one, when checking is off', () => {
    expect(buildLinkChecker(OPTIONS)).toBeUndefined();
  });

  it('returns a checker when checking is on', () => {
    expect(buildLinkChecker({ ...OPTIONS, checkLinks: true })).toBeDefined();
  });
});
