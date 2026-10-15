import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CANDIDATE_PROFILE,
  loadCandidateProfile,
} from '../../src/config/candidate-profile.js';

const temporaryDirectories: string[] = [];

async function temporaryProfilePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'candidate-profile-'));
  temporaryDirectories.push(directory);
  return join(directory, 'candidate-profile.local.json');
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('loadCandidateProfile', () => {
  it('returns the safe committed profile when no local override exists', () => {
    expect(loadCandidateProfile('/missing/candidate-profile.local.json')).toEqual(CANDIDATE_PROFILE);
  });

  it('merges a validated partial local override onto the safe profile', async () => {
    const path = await temporaryProfilePath();
    await writeFile(
      path,
      JSON.stringify({ displayName: 'Morgan Rivera', englishLevel: 'B2' }),
      'utf8',
    );

    expect(loadCandidateProfile(path)).toEqual({
      ...CANDIDATE_PROFILE,
      displayName: 'Morgan Rivera',
      englishLevel: 'B2',
    });
  });

  it('rejects malformed local overrides with a clear error', async () => {
    const path = await temporaryProfilePath();
    await writeFile(path, JSON.stringify({ englishLevel: 'native' }), 'utf8');

    expect(() => loadCandidateProfile(path)).toThrow(/invalid candidate profile/i);
  });
});
