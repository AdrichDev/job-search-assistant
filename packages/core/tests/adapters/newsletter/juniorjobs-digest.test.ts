import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  JUNIORJOBS_DIGEST_FORMAT,
  juniorJobsDigestParser,
} from '../../../src/adapters/newsletter/juniorjobs-digest.js';
import type { NewsletterParseContext } from '../../../src/adapters/newsletter/newsletter-parser.js';
import { WORKSPACE_ROOT } from '../../../src/config/paths.js';

/**
 * The JuniorJobs weekly digest parser, measured against a fixture that mirrors
 * the structure of the REAL email the parser was written from.
 *
 * This project already shipped 13 fabricated URLs because code was written
 * against an imagined payload. The fixture therefore keeps every quirk of the
 * real sample; only the filler entries and link tokens are synthetic.
 */

/*
 * A synthetic digest that reproduces the real email's structure and its quirks
 * (flags, remote tails, a missing article, a pasted title instead of a link),
 * with fictional tokens. The raw email itself stays out of the repository.
 */
const FIXTURE_PATH = resolve(
  WORKSPACE_ROOT,
  'packages/core/tests/fixtures/juniorjobs-digest.synthetic.txt',
);

const RECEIVED_AT = new Date('2026-09-06T00:00:00.000Z');

function context(skipped: string[] = []): NewsletterParseContext {
  return {
    fileName: 'newsletter-2026-09-06.txt',
    receivedAt: RECEIVED_AT,
    skip: (reason) => skipped.push(reason),
  };
}

async function parseFixture() {
  const text = await readFile(FIXTURE_PATH, 'utf8');
  return juniorJobsDigestParser.parse(text, context());
}

describe('juniorjobs digest format detection', () => {
  it('claims the real digest', async () => {
    const text = await readFile(FIXTURE_PATH, 'utf8');
    expect(juniorJobsDigestParser.detect(text)).toBe(true);
  });

  it('declares the format id it is registered under', () => {
    expect(juniorJobsDigestParser.format).toBe(JUNIORJOBS_DIGEST_FORMAT);
  });

  it('refuses text that is not a numbered digest of juniorjobs links', () => {
    expect(juniorJobsDigestParser.detect('')).toBe(false);
    expect(juniorJobsDigestParser.detect('Hola, aqui tienes tu oferta semanal.')).toBe(false);
    // Shape without the sender: a numbered list from some other newsletter must
    // NOT be claimed, or this parser silently mangles a format nobody verified.
    expect(
      juniorJobsDigestParser.detect('1. Acme busca a un Backend Engineer: https://example.com/a'),
    ).toBe(false);
  });
});

describe('juniorjobs digest parsing against the real sample', () => {
  it('finds every numbered entry in the digest', async () => {
    const postings = await parseFixture();
    expect(postings).toHaveLength(222);
  });

  it('reports a link for every entry that has one, and null for the one that does not', async () => {
    const postings = await parseFixture();
    const withLink = postings.filter((posting) => posting.url !== null);
    const withoutLink = postings.filter((posting) => posting.url === null);

    expect(withLink).toHaveLength(221);
    expect(withoutLink).toHaveLength(1);
    // Entry 171 in the digest is a copy/paste accident: the sender pasted the
    // job title where the link belonged. It must surface as "no link", never as
    // a link built out of that title.
    expect(withoutLink[0]?.company).toBe('Amazon');
  });

  it('takes every link verbatim from the digest body', async () => {
    const text = await readFile(FIXTURE_PATH, 'utf8');
    const postings = juniorJobsDigestParser.parse(text, context());

    const inPayload = new Set(
      [...text.matchAll(/https?:\/\/[^\s*]+/g)].map((match) => match[0].replace(/[.,*]+$/, '')),
    );

    for (const posting of postings) {
      if (posting.url !== null) {
        expect(inPayload.has(posting.url), `link not present in the digest: ${posting.url}`).toBe(
          true,
        );
      }
    }
  });

  it('reads company, title, remoteness and country off entry 1', async () => {
    const postings = await parseFixture();
    expect(postings[0]).toMatchObject({
      company: 'Factorial',
      title: 'GTM Engineer Factorial IT',
      countryCode: 'ES',
      remote: false,
      url: 'https://juniorjobs.short.gy/tok0001',
    });
  });

  it('strips the "100% en remoto" tail out of the title and records it as remoteness', async () => {
    const postings = await parseFixture();
    expect(postings[1]).toMatchObject({
      company: 'Idealista',
      title: 'Android Product Engineer',
      remote: true,
      url: 'https://juniorjobs.short.gy/tok0002',
    });
  });

  it('reads the country flag when the entry carries one', async () => {
    const postings = await parseFixture();
    // "17. ..DE.. N26 busca a un iOS Engineer - Digital Identity"
    expect(postings[16]).toMatchObject({
      company: 'N26',
      title: 'iOS Engineer - Digital Identity',
      countryCode: 'DE',
    });
  });

  it('handles an entry with no article before the title', async () => {
    const postings = await parseFixture();
    // "214. Raiola Networks busca Administradores/as de sistemas Linux junior"
    expect(postings[213]).toMatchObject({
      company: 'Raiola Networks',
      title: 'Administradores/as de sistemas Linux junior',
    });
  });

  it('handles the "tiene disponible su <programme>" phrasing', async () => {
    const postings = await parseFixture();
    // "88. Revolut tiene disponible su Internship Programme 2027: Product Owner (UX), 100% en remoto"
    expect(postings[87]).toMatchObject({
      company: 'Revolut',
      title: 'Internship Programme 2027: Product Owner (UX)',
      remote: true,
    });
  });

  it('strips a chained connective clause off the employer name', async () => {
    const postings = await parseFixture();
    // "218. Sigue CaixaBank Tech, ahora con un Software Engineer Java + Python (Junior)"
    // used to yield the employer "CaixaBank Tech, ahora", which then failed to
    // dedupe against entry 217's "CaixaBank Tech" - the same employer, twice.
    expect(postings[217]).toMatchObject({
      company: 'CaixaBank Tech',
      title: 'Software Engineer Java + Python (Junior)',
    });
  });

  it('leaves no employer name ending in a dangling connective', async () => {
    const postings = await parseFixture();
    for (const posting of postings) {
      expect(
        posting.company,
        `"${posting.company}" ends in sentence glue rather than a name`,
      ).not.toMatch(/[,\s](?:que|con|para|y|ahora|tambien|tambi[ée]n)$/i);
    }
  });

  it('never lets a title leak into the identifier it will be deduped by', async () => {
    const postings = await parseFixture();

    for (const posting of postings) {
      if (posting.url === null) {
        continue;
      }
      // The external id is the payload's own link. If it were derived from the
      // title, the title's words would appear in it.
      expect(posting.externalId).toBe(posting.url);
    }
  });

  it('leaves no posting with an empty company or title', async () => {
    const postings = await parseFixture();
    for (const posting of postings) {
      expect(posting.company.trim().length).toBeGreaterThan(0);
      expect(posting.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('dates every posting from the digest it arrived in', async () => {
    const postings = await parseFixture();
    for (const posting of postings) {
      expect(posting.postedAt.toISOString()).toBe(RECEIVED_AT.toISOString());
    }
  });
});

describe('juniorjobs digest degrades instead of crashing', () => {
  it('returns nothing for an empty file', () => {
    expect(juniorJobsDigestParser.parse('', context())).toEqual([]);
  });

  it('returns nothing for prose with no numbered entries', () => {
    expect(
      juniorJobsDigestParser.parse('Buenos dias.\n\nNo hay ofertas esta semana.\n', context()),
    ).toEqual([]);
  });

  it('keeps the entries it understood when a later line is truncated mid-way', () => {
    const partial = [
      '1. Acme busca a un Backend Engineer: https://juniorjobs.short.gy/aaaaaa',
      '2. ',
      '3. Beta busca a un Frontend Engineer: https://juniorjobs.short.gy/bbbbbb',
    ].join('\n');

    const postings = juniorJobsDigestParser.parse(partial, context());
    expect(postings.map((posting) => posting.company)).toEqual(['Acme', 'Beta']);
  });

  it('reports a skip rather than throwing when an entry carries no usable text', () => {
    const skipped: string[] = [];
    const postings = juniorJobsDigestParser.parse('1. *  *\n', context(skipped));

    expect(postings).toEqual([]);
    expect(skipped.length).toBeGreaterThan(0);
  });
});
