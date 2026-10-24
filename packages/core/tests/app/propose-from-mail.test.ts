import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createJsonMailProposalRepository } from '../../src/adapters/persistence/json-mail-proposal-repository.js';
import { proposeFromMail } from '../../src/app/propose-from-mail.js';
import { createApplication, type ApplicationOutcome } from '../../src/domain/application.js';
import type { MailProposalRepository } from '../../src/ports/mail-proposal-repository.js';
import type { MailMessage } from '../../src/ports/gmail-reader.js';

let directory: string;
let repository: MailProposalRepository;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'propose-mail-'));
  repository = createJsonMailProposalRepository({ filePath: join(directory, 'p.json') });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const NOW = new Date('2026-03-01T09:00:00Z');
const now = () => NOW;

function application(
  company: string,
  outcome: ApplicationOutcome = 'applied',
  appliedAt = '2026-02-01T00:00:00Z',
) {
  return createApplication({
    jobId: `${company.toLowerCase()}::desarrollador::madrid`,
    appliedAt: new Date(appliedAt),
    outcome,
  });
}

function message(overrides: Partial<MailMessage> & { id: string }): MailMessage {
  return {
    threadId: `t-${overrides.id}`,
    receivedAt: new Date('2026-02-10T10:00:00Z'),
    from: 'rrhh@nubesol.example',
    subject: 'Entrevista',
    snippet: 'Nubesol te invita a una entrevista.',
    ...overrides,
  };
}

const run = (messages: MailMessage[], applications = [application('Nubesol')]) =>
  proposeFromMail({ messages, applications, repository, now });

describe('proposeFromMail', () => {
  it('creates a pending proposal for a clear reply from the matching company', async () => {
    const result = await run([message({ id: 'm1' })]);
    expect(result).toEqual({
      proposed: 1,
      skippedNoSignal: 0,
      skippedDuplicate: 0,
      unmatched: 0,
      ambiguous: 0,
      unchanged: 0,
    });
    const [proposal] = await repository.listPending();
    expect(proposal).toMatchObject({
      jobId: 'nubesol::desarrollador::madrid',
      proposedOutcome: 'interview',
      messageId: 'm1',
      status: 'pending',
      detectedAt: NOW,
    });
    expect(proposal?.evidence).toContain('entrevista');
  });

  it('stamps the portal the alert sender reveals onto the proposal', async () => {
    await run([message({ id: 'm-portal', from: 'no-reply@infojobs.net' })]);
    const [proposal] = await repository.listPending();
    expect(proposal?.portal).toBe('infojobs');
  });

  it('leaves the portal out when the sender is a personal address', async () => {
    await run([message({ id: 'm-personal', from: 'rrhh@gmail.com' })]);
    const [proposal] = await repository.listPending();
    expect(proposal).not.toBeNull();
    expect('portal' in (proposal ?? {})).toBe(false);
  });

  it('is idempotent: running twice creates nothing new', async () => {
    await run([message({ id: 'm1' })]);
    const second = await run([message({ id: 'm1' })]);
    expect(second.proposed).toBe(0);
    expect(second.skippedDuplicate).toBe(1);
    expect(await repository.list()).toHaveLength(1);
  });

  it('does not re-propose a dismissed mail', async () => {
    await run([message({ id: 'm1' })]);
    const [created] = await repository.list();
    await repository.markDismissed(created!.id);
    const second = await run([message({ id: 'm1' })]);
    expect(second.skippedDuplicate).toBe(1);
    expect(await repository.listPending()).toEqual([]);
  });

  it('skips mail with no clear signal', async () => {
    const result = await run([
      message({ id: 'm1', subject: 'Candidatura recibida', snippet: 'Nubesol: hemos recibido tu candidatura.' }),
    ]);
    expect(result.skippedNoSignal).toBe(1);
    expect(await repository.list()).toEqual([]);
  });

  it('counts a message from an unknown company as unmatched', async () => {
    const result = await run([
      message({ id: 'm1', from: 'rrhh@otraempresa.example', snippet: 'Otraempresa te invita a una entrevista.' }),
    ]);
    expect(result.unmatched).toBe(1);
    expect(await repository.list()).toEqual([]);
  });

  it('matches the company through the sender when the text omits it', async () => {
    const result = await run([message({ id: 'm1', snippet: 'Te invitamos a una entrevista.' })]);
    expect(result.proposed).toBe(1);
  });

  it('matches accent- and case-insensitively', async () => {
    const result = await run(
      [message({ id: 'm1', from: 'x@y.example', snippet: 'CAFÉ DEL SUR te invita a una entrevista.' })],
      [application('Café del Sur')],
    );
    expect(result.proposed).toBe(1);
  });

  it('refuses to guess when two applications match', async () => {
    const result = await run(
      [message({ id: 'm1' })],
      [application('Nubesol'), application('Nubesol', 'screening', '2026-02-05T00:00:00Z')],
    );
    expect(result.ambiguous).toBe(1);
    expect(result.proposed).toBe(0);
    expect(await repository.list()).toEqual([]);
  });

  it.each<ApplicationOutcome>(['rejected', 'offer', 'no_reply'])(
    'ignores an application that is no longer open (%s)',
    async (outcome) => {
      const result = await run([message({ id: 'm1' })], [application('Nubesol', outcome)]);
      expect(result.unmatched).toBe(1);
      expect(await repository.list()).toEqual([]);
    },
  );

  it.each<ApplicationOutcome>(['applied', 'screening'])('considers an open application (%s)', async (outcome) => {
    const result = await run([message({ id: 'm1' })], [application('Nubesol', outcome)]);
    expect(result.proposed).toBe(1);
  });

  it('ignores an application made after the message', async () => {
    const result = await run(
      [message({ id: 'm1', receivedAt: new Date('2026-01-20T10:00:00Z') })],
      [application('Nubesol', 'applied', '2026-02-01T00:00:00Z')],
    );
    expect(result.unmatched).toBe(1);
    expect(await repository.list()).toEqual([]);
  });

  it('accepts a message on the application day', async () => {
    const result = await run(
      [message({ id: 'm1', receivedAt: new Date('2026-02-01T00:00:00Z') })],
      [application('Nubesol', 'applied', '2026-02-01T00:00:00Z')],
    );
    expect(result.proposed).toBe(1);
  });

  it('skips a proposal equal to the current outcome', async () => {
    const result = await run([message({ id: 'm1' })], [application('Nubesol', 'interview')]);
    expect(result.unchanged).toBe(1);
    expect(result.proposed).toBe(0);
    expect(await repository.list()).toEqual([]);
  });

  it('uses the listing company of an imported application', async () => {
    const imported = createApplication({
      jobId: 'import-abc123',
      appliedAt: new Date('2026-02-01T00:00:00Z'),
      listing: { company: 'Zafiro Labs S.L.', title: 'Backend' },
    });
    const result = await run(
      [message({ id: 'm1', from: 'x@y.example', snippet: 'Zafiro Labs te invita a una entrevista.' })],
      [imported],
    );
    expect(result.proposed).toBe(1);
    expect((await repository.list())[0]?.jobId).toBe('import-abc123');
  });

  it('classifies several messages in one pass', async () => {
    const result = await run([
      message({ id: 'm1' }),
      message({ id: 'm2', subject: 'Hola', snippet: 'Gracias' }),
      message({ id: 'm3', subject: 'Otra', snippet: 'Lamentablemente no continuaremos con tu candidatura. Otraempresa', from: 'a@otra.example' }),
    ]);
    expect(result).toMatchObject({ proposed: 1, skippedNoSignal: 1, unmatched: 1 });
  });

  it('never writes to the application repository', async () => {
    // The use case takes no application repository at all, and the applications it
    // reads are frozen: any write attempt would throw in strict mode.
    const apps = [application('Nubesol')].map((a) => Object.freeze({ ...a, sourceIds: Object.freeze([...a.sourceIds]) }));
    const result = await run([message({ id: 'm1' })], apps);
    expect(result.proposed).toBe(1);
    expect(apps[0]?.outcome).toBe('applied');
  });
});

describe('proposeFromMail basedOnOutcome', () => {
  it('remembers the outcome the application had when the proposal was made', async () => {
    await run([message({ id: 'm1' })], [application('Nubesol', 'screening')]);
    const [proposal] = await repository.listPending();
    expect(proposal?.basedOnOutcome).toBe('screening');
  });
});
