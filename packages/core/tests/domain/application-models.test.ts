import { describe, expect, it } from 'vitest';
import {
  applicationsEqual,
  applyApplicationPatch,
  createApplication,
  type Application,
  type ApplicationPatch,
} from '../../src/domain/application.js';
import { withOutcome } from '../../src/domain/application.js';
import { diffApplications, fieldValue, patchRestoring } from '../../src/domain/application-history.js';
import { computeApplicationStats } from '../../src/domain/application-stats.js';

const NOW = new Date('2026-04-10T09:30:00.000Z');

const LEGACY: Application = createApplication({
  jobId: 'beta soluciones::qa júnior::barcelona',
  appliedAt: new Date('2026-02-10T00:00:00.000Z'),
  cvVariant: 'general',
  scoreAtApply: 61,
});

const IMPORTED: Application = createApplication({
  jobId: 'import-aaaa1111',
  appliedAt: new Date('2026-03-01T00:00:00.000Z'),
  listing: { company: 'Información Ñandú S.L.', title: 'Desarrollador Júnior' },
});

function ok(application: Application, patch: ApplicationPatch) {
  const result = applyApplicationPatch(application, patch, NOW);
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

describe('model references in a patch', () => {
  it('sets, changes and clears both ids', () => {
    const set = ok(LEGACY, { cvModelId: ' cv-1 ', letterModelId: 'let-1' });
    expect(set.changed).toBe(true);
    expect(set.application.cvModelId).toBe('cv-1');
    expect(set.application.letterModelId).toBe('let-1');
    // legacy lane and frozen fields untouched
    expect(set.application.cvVariant).toBe('general');
    expect(set.application.scoreAtApply).toBe(61);

    const changed = ok(set.application, { cvModelId: 'cv-2' });
    expect(changed.application.cvModelId).toBe('cv-2');
    expect(changed.application.letterModelId).toBe('let-1');

    const cleared = ok(changed.application, { cvModelId: null, letterModelId: '   ' });
    expect('cvModelId' in cleared.application).toBe(false);
    expect('letterModelId' in cleared.application).toBe(false);
  });

  it('absent key leaves the ids unchanged and a same-value patch is a no-op', () => {
    const withIds = ok(IMPORTED, { cvModelId: 'cv-1' }).application;
    expect(ok(withIds, { notes: 'x' }).application.cvModelId).toBe('cv-1');
    const same = ok(withIds, { cvModelId: 'cv-1' });
    expect(same.changed).toBe(false);
  });

  it('refuses a too long id with too_long and never writes blank keys', () => {
    const result = applyApplicationPatch(LEGACY, { cvModelId: 'x'.repeat(81) }, NOW);
    expect(result).toEqual({ ok: false, reason: 'too_long' });
    expect(ok(LEGACY, { cvModelId: 'x'.repeat(80) }).application.cvModelId).toHaveLength(80);
  });

  it('counts the ids in applicationsEqual', () => {
    const a = ok(LEGACY, { cvModelId: 'cv-1' }).application;
    expect(applicationsEqual(LEGACY, a)).toBe(false);
    expect(applicationsEqual(a, { ...a })).toBe(true);
    const l = ok(LEGACY, { letterModelId: 'let-1' }).application;
    expect(applicationsEqual(LEGACY, l)).toBe(false);
  });

  it('createApplication trims and drops blank ids', () => {
    const made = createApplication({ jobId: 'j', appliedAt: NOW, cvModelId: ' a ', letterModelId: ' ' });
    expect(made.cvModelId).toBe('a');
    expect('letterModelId' in made).toBe(false);
  });

  it('withOutcome keeps the ids', () => {
    const a = ok(LEGACY, { cvModelId: 'cv-1', letterModelId: 'let-1' }).application;
    const b = withOutcome(a, 'rejected', NOW);
    expect(b.cvModelId).toBe('cv-1');
    expect(b.letterModelId).toBe('let-1');
  });
});

describe('model references in the history', () => {
  it('diffs, reads values and restores both fields', () => {
    const after = ok(LEGACY, { cvModelId: 'cv-1', letterModelId: 'let-1' }).application;
    const changes = diffApplications(LEGACY, after);
    expect(changes).toEqual([
      { field: 'cvModelId', before: null, after: 'cv-1' },
      { field: 'letterModelId', before: null, after: 'let-1' },
    ]);
    expect(fieldValue(after, 'cvModelId')).toBe('cv-1');
    expect(fieldValue(LEGACY, 'letterModelId')).toBeNull();

    const restored = ok(after, patchRestoring(changes)).application;
    expect(applicationsEqual(restored, LEGACY)).toBe(true);
    expect('cvModelId' in restored).toBe(false);
  });

  it('restores a previous id after a change', () => {
    const first = ok(LEGACY, { cvModelId: 'cv-1' }).application;
    const second = ok(first, { cvModelId: 'cv-2' }).application;
    const restored = ok(second, patchRestoring(diffApplications(first, second))).application;
    expect(restored.cvModelId).toBe('cv-1');
  });
});

describe('byModel stats', () => {
  function app(id: string, cvModelId: string | undefined, outcome: 'applied' | 'rejected' | 'interview' | 'no_reply', variant?: 'general') {
    const base = createApplication({
      jobId: id,
      appliedAt: NOW,
      ...(cvModelId === undefined ? {} : { cvModelId }),
      ...(variant === undefined ? {} : { cvVariant: variant }),
    });
    return outcome === 'applied' ? base : withOutcome(base, outcome, NOW);
  }

  it('is empty without models', () => {
    expect(computeApplicationStats([]).byModel).toEqual([]);
    expect(computeApplicationStats([app('a', undefined, 'applied')]).byModel).toEqual([]);
  });

  it('counts, rates and orders most used first then by id; excludes applications without a model', () => {
    const stats = computeApplicationStats([
      app('1', 'zeta', 'interview'),
      app('2', 'alfa', 'rejected'),
      app('3', 'alfa', 'applied'),
      app('4', 'zeta', 'no_reply'),
      app('5', 'beta', 'applied'),
      app('6', undefined, 'interview', 'general'),
      app('7', 'alfa', 'applied'),
    ]);
    expect(stats.byModel.map((m) => m.modelId)).toEqual(['alfa', 'zeta', 'beta']);
    expect(stats.byModel[0]).toEqual({
      modelId: 'alfa',
      applied: 3,
      responses: 1,
      advances: 0,
      responseRate: 1 / 3,
      advanceRate: 0,
    });
    const zeta = stats.byModel[1]!;
    expect(zeta).toMatchObject({ applied: 2, responses: 1, advances: 1, responseRate: 0.5, advanceRate: 0.5 });
    // legacy per-variant stats unaffected
    expect(stats.byVariant).toHaveLength(1);
    expect(stats.byVariant[0]).toMatchObject({ cvVariant: 'general', applied: 1 });
    expect(stats.totalApplied).toBe(7);
  });

  it('ties by used count order by id', () => {
    const stats = computeApplicationStats([app('1', 'b', 'applied'), app('2', 'a', 'applied')]);
    expect(stats.byModel.map((m) => m.modelId)).toEqual(['a', 'b']);
  });
});

describe('model change through the edit and revert use cases', () => {
  it('logs a model change and undoes it back to the identical record', async () => {
    const { editApplication } = await import('../../src/app/edit-application.js');
    const { revertApplicationChange } = await import('../../src/app/revert-application-change.js');
    const { createInMemoryApplicationRepository } = await import('../helpers/in-memory-application-repository.js');
    const { createInMemoryApplicationHistoryRepository } = await import(
      '../helpers/in-memory-application-history-repository.js'
    );
    const repository = createInMemoryApplicationRepository([LEGACY]);
    const history = createInMemoryApplicationHistoryRepository();
    let n = 0;
    const deps = { repository, history, now: () => new Date(Date.UTC(2026, 3, 10, 9, 0, n++)), newId: () => `id-${n}` };

    const edited = await editApplication({ jobId: LEGACY.jobId, patch: { cvModelId: 'cv-1', letterModelId: 'let-1' } }, deps);
    expect(edited).toMatchObject({ status: 'updated', historyRecorded: true });
    const [entry] = history.all();
    expect(entry?.changes.map((c) => c.field)).toEqual(['cvModelId', 'letterModelId']);

    const reverted = await revertApplicationChange({ entryId: entry?.id as string }, deps);
    expect(reverted.status).toBe('reverted');
    const back = await repository.findByJobId(LEGACY.jobId);
    expect(JSON.stringify(back)).toBe(JSON.stringify(LEGACY));
  });
});
