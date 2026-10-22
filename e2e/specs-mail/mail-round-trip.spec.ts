import { expect, test } from '../support/test.js';
import { HEALTHY_QUEUE } from '../fixtures/queue.js';
import { readMailProposals, seedMailRunState } from '../support/mail.js';
import { readApplications, seedApplications } from '../support/workspace.js';

/**
 * The round trip that had no proof: a real check through the whole pipeline
 * (reader -> classifier -> matcher -> pending proposal -> modal) with no Gmail
 * and no seeded proposal file.
 *
 * This spec runs under `playwright.mail.config.ts`, where the server uses the
 * deterministic fake reader in `proposal` mode: it answers ONE message that
 * reads as a rejection and names "Acme Sistemas".
 */

const ACME = 'import-acme0001';

test('a check on a reply creates the proposal and the modal asks first', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);
  await seedApplications([
    {
      jobId: ACME,
      appliedAt: '2026-03-01T00:00:00.000Z',
      sourceIds: ['infojobs'],
      outcome: 'applied',
      listing: { company: 'Acme Sistemas', title: 'Desarrollador Backend Júnior' },
    },
  ]);
  /*
   * Not due: a success at THIS instant is after the most recent 08:00 Madrid, so
   * the on-open catch-up does nothing and the only thing that can run the check
   * below is the button. A hard-coded date would be in the past on the day the
   * suite runs and the catch-up would fire, which is how this spec first failed:
   * the modal was already open when the click arrived.
   */
  const now = new Date().toISOString();
  await seedMailRunState({ lastSuccessAt: now, lastAttemptAt: now });

  await page.goto('/seguimiento');
  await expect(page.getByTestId('mail-proposals-modal')).toHaveCount(0);
  // The page knows mail is configured (the fake arm) and says when it last ran.
  await expect(page.getByText(/Última revisión del correo:/)).toBeVisible();

  await page.getByRole('button', { name: 'Revisar correo ahora' }).click();

  // The check turns the message into ONE pending proposal, and the modal asks.
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('Acme Sistemas');
  await expect(modal).toContainText('Rechazada');
  await expect(modal).toContainText('no seguimos adelante');

  const proposals = await readMailProposals();
  expect(proposals).toHaveLength(1);
  expect(proposals[0]?.status).toBe('pending');
  expect(proposals[0]?.jobId).toBe(ACME);

  // Mail only proposes: the application itself is untouched until confirmation.
  const applications = await readApplications();
  expect(applications.find((row) => row.jobId === ACME)?.outcome).toBe('applied');

  // Confirming applies it through the append-only path.
  await modal.getByRole('button', { name: 'Aceptar' }).click();
  await expect(page.getByRole('status')).toContainText('Estado actualizado');

  const after = await readApplications();
  expect(after.find((row) => row.jobId === ACME)?.outcome).toBe('rejected');
  const decided = await readMailProposals();
  expect(decided.map((row) => row.status)).toEqual(['accepted']);
});

test('a second check does not duplicate the proposal it already made', async ({ seed, page }) => {
  await seed(HEALTHY_QUEUE);
  await seedApplications([
    {
      jobId: ACME,
      appliedAt: '2026-03-01T00:00:00.000Z',
      sourceIds: ['infojobs'],
      outcome: 'applied',
      listing: { company: 'Acme Sistemas', title: 'Desarrollador Backend Júnior' },
    },
  ]);
  const now = new Date().toISOString();
  await seedMailRunState({ lastSuccessAt: now, lastAttemptAt: now });

  await page.goto('/seguimiento');
  await page.getByRole('button', { name: 'Revisar correo ahora' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Cancel, then ask again: the same message id must not create a second row.
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Revisar correo ahora' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const proposals = await readMailProposals();
  expect(proposals).toHaveLength(1);
});
