import { describe, expect, it } from 'vitest';
import {
  BOARD_SOURCE_IDS,
  REAL_SOURCE_IDS,
  SAMPLE_SOURCE_IDS,
  SELECTABLE_SOURCE_IDS,
  parseSourceSelection,
} from '../../src/cli/source-selection.js';

/**
 * `--source` grew from a three-way enum into a set. Parsing it is pure, so it
 * is tested here instead of through the CLI's side effects.
 */
describe('parseSourceSelection', () => {
  it('defaults to the offline fixture, so a bare run never touches the network', () => {
    expect(parseSourceSelection(undefined)).toEqual(['fixture']);
  });

  it('keeps the single-source form working', () => {
    expect(parseSourceSelection('fixture')).toEqual(['fixture']);
    expect(parseSourceSelection('greenhouse')).toEqual(['greenhouse']);
    expect(parseSourceSelection('lever')).toEqual(['lever']);
    expect(parseSourceSelection('ashby')).toEqual(['ashby']);
  });

  /*
   * THE DEFECT THIS BLOCK EXISTS FOR.
   *
   * `--source=all` used to expand to every selectable source, fixture included,
   * so the documented command mixed 105 invented demo postings - links on the
   * reserved, non-resolving `example-board.test` domain - into a queue of real
   * vacancies. Two of them took positions #1 and #3.
   *
   * "All" now means all REAL sources. The sample catalogue is not a source of
   * job market information; it is a demo, and a demo has to be asked for.
   */
  it('EXCLUDES the fixture from all: "all" means every REAL source', () => {
    expect(parseSourceSelection('all')).not.toContain('fixture');
    expect(parseSourceSelection('all')).toEqual([...REAL_SOURCE_IDS]);
  });

  it('still runs the fixture when it is asked for by name', () => {
    expect(parseSourceSelection('fixture')).toEqual(['fixture']);
  });

  it('refuses to mix sample data with real sources, and says which token did it', () => {
    // Rejected rather than merely announced. A mixed queue asks the reader to
    // re-check the provenance of every row they are about to act on, and a
    // warning above a ranked list is exactly the thing people stop reading.
    expect(() => parseSourceSelection('fixture,greenhouse')).toThrow(/fixture/);
    expect(() => parseSourceSelection('fixture,greenhouse')).toThrow(/sample/i);
    expect(() => parseSourceSelection('boards,fixture')).toThrow(/fixture/);
    expect(() => parseSourceSelection('all,fixture')).toThrow(/fixture/);
  });

  it('rejects aggregator because it is no longer a supported source', () => {
    expect(() => parseSourceSelection('aggregator')).toThrow(/aggregator/);
    expect(parseSourceSelection('all')).not.toContain('aggregator');
    expect(SELECTABLE_SOURCE_IDS).not.toContain('aggregator');
  });

  it('declares exactly one sample source, and it is the fixture', () => {
    expect(SAMPLE_SOURCE_IDS).toEqual(['fixture']);
    for (const id of REAL_SOURCE_IDS) {
      expect(SAMPLE_SOURCE_IDS).not.toContain(id);
    }
  });

  it('accepts a comma-separated set', () => {
    expect(parseSourceSelection('greenhouse,lever,ashby')).toEqual([
      'greenhouse',
      'lever',
      'ashby',
    ]);
  });

  it('tolerates spaces around the separators', () => {
    expect(parseSourceSelection(' greenhouse , lever ')).toEqual(['greenhouse', 'lever']);
  });

  it('expands the boards shortcut to exactly the company-board providers', () => {
    expect(parseSourceSelection('boards')).toEqual([...BOARD_SOURCE_IDS]);
    /*
     * Four since SmartRecruiters was added, and the exact list is still pinned
     * rather than asserted loosely: `boards` describes a KIND of source (a
     * per-company ATS with no key and no search endpoint), so a new member is a
     * deliberate decision that should have to be written down here. What must
     * never appear is `manfred`, `landingjobs`, `arbeitnow` or `aggregator` -
     * none of them is a company board, and a shortcut that
     * quietly widened would make `--source=boards` unpredictable.
     */
    expect(BOARD_SOURCE_IDS).toEqual(['greenhouse', 'lever', 'ashby', 'smartrecruiters']);
  });

  it('expands all to every real source, and every real source is selectable', () => {
    expect(parseSourceSelection('all')).toEqual([...REAL_SOURCE_IDS]);
    for (const id of REAL_SOURCE_IDS) {
      expect(SELECTABLE_SOURCE_IDS).toContain(id);
    }
  });

  it('never puts aggregator in the boards shortcut', () => {
    // generic aggregator's free quota is exhausted; `--source=boards` must be a safe way to
    // run without touching it.
    expect(parseSourceSelection('boards')).not.toContain('aggregator');
  });

  it('collapses duplicates while preserving first-mentioned order', () => {
    expect(parseSourceSelection('lever,greenhouse,lever')).toEqual(['lever', 'greenhouse']);
    expect(parseSourceSelection('boards,greenhouse')).toEqual([...BOARD_SOURCE_IDS]);
  });

  it('rejects an unknown source and names the valid ones', () => {
    expect(() => parseSourceSelection('linkedin')).toThrow(/linkedin/);
    expect(() => parseSourceSelection('linkedin')).toThrow(/greenhouse/);
  });

  it('rejects an empty selection rather than silently running nothing', () => {
    expect(() => parseSourceSelection('')).toThrow(/--source/);
    expect(() => parseSourceSelection(',,')).toThrow(/--source/);
  });

  it('is case-insensitive, because shells and humans are', () => {
    expect(parseSourceSelection('Greenhouse,ASHBY')).toEqual(['greenhouse', 'ashby']);
  });
});
