import { readFile } from 'node:fs/promises';
import { applyLinkFor, expect, test } from '../support/test.js';
import {
  BASELINE_PATH,
  REAL_USER_FILES,
  fingerprint,
  type FileFingerprint,
} from '../support/global-setup.js';
import {
  SCRATCH_APPLICATIONS_PATH,
  SCRATCH_HISTORY_PATH,
  readApplications,
  readHistory,
  seedApplications,
} from '../support/workspace.js';
import { HEALTHY_QUEUE, HEALTHY_TITLES } from '../fixtures/queue.js';

/**
 * Proof that the suite did not touch the user's real data.
 *
 * The `zz-` prefix is load-bearing: Playwright orders spec files by path, so
 * this runs last and sees the state left behind by every journey above,
 * including all the ones that click "Aplicar" and cause genuine writes.
 *
 * Why this is a test at all, rather than a comment promising isolation: the
 * failure it guards against is silent. If `JOB_QUEUE_APPLICATIONS_PATH` were
 * dropped from the config, every other spec would still pass - while appending
 * fake applications to the human's actual job-hunting history and overwriting
 * the queue from their last real pipeline run. Nobody would notice until they
 * went looking for their own records.
 *
 * A test suite that eats the user's data is a worse bug than the one it was
 * written to catch.
 */

test.describe('real user data is untouched', () => {
  test('a real write lands in the scratch log, not in the user log', async ({ page, seed }) => {
    /*
     * Self-contained rather than leaning on residue from earlier specs: each of
     * those resets the application log in its own setup, so "the file is
     * non-empty at the end" would be a claim about test ordering rather than
     * about isolation. This performs its own write and then looks in both
     * places.
     *
     * The negative assertion alone is not enough. "The real file did not
     * change" is also true when the app wrote nothing at all - which would mean
     * the apply journeys were passing against a UI that only pretended. So the
     * write is proven to have HAPPENED, and proven to have happened HERE.
     */
    await seed(HEALTHY_QUEUE);
    await page.goto('/');

    const title = HEALTHY_TITLES[0] as string;
    await applyLinkFor(page, title).click();
    await expect(applyLinkFor(page, title)).toContainText('Aplicada', { timeout: 15_000 });

    const scratch = await readApplications();
    expect(
      scratch.length,
      `no application was recorded in ${SCRATCH_APPLICATIONS_PATH}; ` +
        'either the journey did not write, or it wrote somewhere else',
    ).toBe(1);

    expect(JSON.parse(await readFile(SCRATCH_APPLICATIONS_PATH, 'utf8'))).toMatchObject({
      version: 1,
    });
  });

  test('a history write lands in the scratch history, not in the user history', async ({ page, seed }) => {
    // Same two-sided proof as above, for the change history (it quotes personal notes).
    await seed(HEALTHY_QUEUE);
    await seedApplications([
      {
        jobId: 'import-aaaa1111',
        appliedAt: '2026-03-01T00:00:00.000Z',
        sourceIds: ['infojobs'],
        outcome: 'applied',
        listing: { company: 'Información Ñandú S.L.', title: 'Desarrollador Júnior' },
      },
    ]);
    await page.goto('/seguimiento/import-aaaa1111/editar');
    await page.getByLabel('Notas', { exact: true }).fill('nota para el historial');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page).toHaveURL(/edicion=guardada/);

    expect(
      (await readHistory()).length,
      `no history entry was recorded in ${SCRATCH_HISTORY_PATH}; either the edit did not log, or it logged somewhere else`,
    ).toBe(1);
  });

  test('every real user file (queue, applications, dismissals, history, run state) is byte-identical to the baseline', async () => {
    const baseline: readonly FileFingerprint[] = JSON.parse(
      await readFile(BASELINE_PATH, 'utf8'),
    ) as FileFingerprint[];

    expect(baseline).toHaveLength(REAL_USER_FILES.length);

    for (const before of baseline) {
      const after = await fingerprint(before.path);

      expect(
        after.sha256,
        `${before.path} changed during the E2E run.\n` +
          `  before: ${before.sha256 ?? '<absent>'}\n` +
          `  after:  ${after.sha256 ?? '<absent>'}\n` +
          'The isolation overrides are not reaching the server process.',
      ).toBe(before.sha256);

      expect(after.size, `${before.path} changed size during the E2E run`).toBe(before.size);
    }
  });
});
