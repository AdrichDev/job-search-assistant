import { describe, expect, it } from 'vitest';
import { editApplication } from '../../src/app/edit-application.js';
import { revertApplicationChange } from '../../src/app/revert-application-change.js';
import { applicationsEqual, createApplication, type Application } from '../../src/domain/application.js';
import { createInMemoryApplicationHistoryRepository } from '../helpers/in-memory-application-history-repository.js';
import { createInMemoryApplicationRepository } from '../helpers/in-memory-application-repository.js';

const IMPORTED = createApplication({
  jobId: 'import-aaaa1111',
  appliedAt: new Date('2026-03-01T00:00:00.000Z'),
  sourceIds: ['infojobs'],
  notes: 'Ñ'.repeat(20_000),
  listing: { company: 'Información Ñandú S.L.', title: 'Desarrollador Júnior', city: 'Alcobendas' },
});
const LEGACY = createApplication({
  jobId: 'beta soluciones::qa júnior::barcelona',
  appliedAt: new Date('2026-02-10T12:34:56.000Z'),
  cvVariant: 'general',
  scoreAtApply: 61,
  outcome: 'screening',
  outcomeUpdatedAt: new Date('2026-02-15T12:34:56.000Z'),
});

function setup() {
  const repository = createInMemoryApplicationRepository([IMPORTED, LEGACY]);
  const history = createInMemoryApplicationHistoryRepository();
  let tick = 0;
  let counter = 0;
  const clock = () => new Date(Date.UTC(2026, 3, 10, 9, 0, tick++));
  const deps = { repository, history, now: clock, newId: () => `id-${++counter}` };
  const edit = (jobId: string, patch: Parameters<typeof editApplication>[0]['patch']) =>
    editApplication({ jobId, patch }, deps);
  const revert = (entryId: string) => revertApplicationChange({ entryId }, deps);
  const current = async (jobId: string): Promise<Application> => {
    const found = await repository.findByJobId(jobId);
    if (found === null) throw new Error('missing');
    return found;
  };
  return { repository, history, edit, revert, current };
}

describe('revertApplicationChange', () => {
  it('restores byte-equal values and appends a revert entry', async () => {
    const { edit, revert, current, history } = setup();
    await edit(IMPORTED.jobId, { outcome: 'rejected', notes: 'otra', cvVariant: 'frontend', listing: { city: '' } });
    const [entry] = history.all();
    const result = await revert(entry?.id as string);
    expect(result).toMatchObject({ status: 'reverted', historyRecorded: true });
    const restored = await current(IMPORTED.jobId);
    expect(applicationsEqual(restored, IMPORTED)).toBe(true);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(IMPORTED));
    const all = history.all();
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ source: 'revert', revertsId: entry?.id, jobId: IMPORTED.jobId });
    expect(all[1]?.changes.map((change) => change.field).sort()).toEqual(
      entry?.changes.map((change) => change.field).sort(),
    );
  });

  it('restores an outcome edit on a legacy row without re-stamping the date', async () => {
    const { edit, revert, current, history } = setup();
    await edit(LEGACY.jobId, { outcome: 'rejected' });
    await revert(history.all()[0]?.id as string);
    expect(applicationsEqual(await current(LEGACY.jobId), LEGACY)).toBe(true);
  });

  it('reports not_found for an unknown entry', async () => {
    const { revert } = setup();
    expect(await revert('nope')).toEqual({ status: 'not_found' });
  });

  it('reports not_latest for an older entry while a newer one is live', async () => {
    const { edit, revert, history, current } = setup();
    await edit(IMPORTED.jobId, { notes: 'uno' });
    await edit(IMPORTED.jobId, { notes: 'dos' });
    const [first] = history.all();
    expect(await revert(first?.id as string)).toEqual({ status: 'not_latest' });
    expect((await current(IMPORTED.jobId)).notes).toBe('dos');
    expect(history.all()).toHaveLength(2);
  });

  it('reports already_reverted and does not touch anything', async () => {
    const { edit, revert, history, current } = setup();
    await edit(IMPORTED.jobId, { notes: 'uno' });
    const [first] = history.all();
    await revert(first?.id as string);
    const snapshot = await current(IMPORTED.jobId);
    expect(await revert(first?.id as string)).toEqual({ status: 'already_reverted' });
    expect(await current(IMPORTED.jobId)).toEqual(snapshot);
    expect(history.all()).toHaveLength(2);
  });

  it('reports conflict when the application changed outside the log, and changes nothing', async () => {
    const { edit, revert, history, repository, current } = setup();
    await edit(IMPORTED.jobId, { notes: 'uno' });
    // A write that bypasses the history, e.g. the file edited by hand.
    await repository.update({ jobId: IMPORTED.jobId, patch: { notes: 'fuera del registro' }, now: new Date() });
    const snapshot = await current(IMPORTED.jobId);
    expect(await revert(history.all()[0]?.id as string)).toEqual({ status: 'conflict' });
    expect(await current(IMPORTED.jobId)).toEqual(snapshot);
    expect(history.all()).toHaveLength(1);
  });

  it('after undoing the latest, the older entry becomes undoable', async () => {
    const { edit, revert, history, current } = setup();
    await edit(IMPORTED.jobId, { notes: 'uno' });
    await edit(IMPORTED.jobId, { notes: 'dos' });
    const [first, second] = history.all();
    await revert(second?.id as string);
    expect((await current(IMPORTED.jobId)).notes).toBe('uno');
    expect(await revert(first?.id as string)).toMatchObject({ status: 'reverted' });
    expect(applicationsEqual(await current(IMPORTED.jobId), IMPORTED)).toBe(true);
    // The undo of the second entry is no longer the newest: it cannot be undone any more.
    const firstRevert = history.all().find((entry) => entry.revertsId === second?.id);
    expect(await revert(firstRevert?.id as string)).toEqual({ status: 'not_latest' });
  });

  it('allows undoing the undo while it is the newest entry', async () => {
    const { edit, revert, history, current } = setup();
    await edit(IMPORTED.jobId, { notes: 'uno' });
    const [first] = history.all();
    await revert(first?.id as string);
    const undo = history.all()[1];
    expect(await revert(undo?.id as string)).toMatchObject({ status: 'reverted' });
    expect((await current(IMPORTED.jobId)).notes).toBe('uno');
    expect(history.all()[2]).toMatchObject({ source: 'revert', revertsId: undo?.id });
    // The original is live again; the first undo is marked as reverted.
    expect(await revert(undo?.id as string)).toEqual({ status: 'already_reverted' });
  });

  it('does not leave a listing-less row broken: undoing a listing creation keeps company and title (known limitation)', async () => {
    const { edit, revert, current, history } = setup();
    await edit(LEGACY.jobId, { listing: { company: 'Beta Soluciones', title: 'QA Júnior', city: 'Girona' } });
    const result = await revert(history.all()[0]?.id as string);
    expect(result).toMatchObject({ status: 'reverted' });
    const after = await current(LEGACY.jobId);
    expect(after.listing).toEqual({ company: 'Beta Soluciones', title: 'QA Júnior' });
  });

  it('keeps the revert recorded as false when the append fails, without hiding it', async () => {
    const repository = createInMemoryApplicationRepository([IMPORTED]);
    const ok = createInMemoryApplicationHistoryRepository();
    const now = () => new Date('2026-04-10T09:30:00.000Z');
    await editApplication({ jobId: IMPORTED.jobId, patch: { notes: 'a' } }, { repository, history: ok, now, newId: () => 'e1' });
    const broken = { ...ok, append: async () => { throw new Error('disk full'); } };
    const result = await revertApplicationChange({ entryId: 'e1' }, { repository, history: broken, now });
    expect(result).toMatchObject({ status: 'reverted', historyRecorded: false });
    expect(applicationsEqual((await repository.findByJobId(IMPORTED.jobId)) as Application, IMPORTED)).toBe(true);
  });
});
