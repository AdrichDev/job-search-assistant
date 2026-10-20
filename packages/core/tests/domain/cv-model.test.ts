import { describe, expect, it } from 'vitest';
import {
  CV_MODEL_LIMITS,
  checkRelativePath,
  normalizeTags,
  relativePathKey,
  validateCvModelDraft,
  validateCvModelPatch,
} from '../../src/domain/cv-model.js';

const VALID = {
  name: 'CV Java backend',
  kind: 'cv',
  language: 'es',
  tags: ['Java', 'Spring Boot'],
  relativePath: 'java/cv.pdf',
};

describe('normalizeTags', () => {
  it('trims, lowercases, de-duplicates and keeps first-seen order', () => {
    expect(normalizeTags([' Java ', 'JAVA', 'Spring  Boot', 'java'])).toEqual({
      ok: true,
      tags: ['java', 'spring  boot'],
    });
  });

  it('drops blank tags and accepts an absent list as empty', () => {
    expect(normalizeTags(['', '   ', 'react'])).toEqual({ ok: true, tags: ['react'] });
    expect(normalizeTags(undefined)).toEqual({ ok: true, tags: [] });
  });

  it('refuses a non-array and non-string members', () => {
    expect(normalizeTags('java')).toEqual({ ok: false, reason: 'invalid_tags' });
    expect(normalizeTags(['a', 3])).toEqual({ ok: false, reason: 'invalid_tags' });
    expect(normalizeTags([{}])).toEqual({ ok: false, reason: 'invalid_tags' });
  });

  it('enforces the count and length limits AFTER de-duplication', () => {
    const twelve = Array.from({ length: CV_MODEL_LIMITS.maxTags }, (_, i) => `t${i}`);
    expect(normalizeTags(twelve).ok).toBe(true);
    expect(normalizeTags([...twelve, 't0', 'T0'])).toMatchObject({ ok: true });
    expect(normalizeTags([...twelve, 'extra'])).toEqual({ ok: false, reason: 'too_many_tags' });
    expect(normalizeTags(['x'.repeat(40)]).ok).toBe(true);
    expect(normalizeTags(['x'.repeat(41)])).toEqual({ ok: false, reason: 'tag_too_long' });
  });

  it('refuses control characters inside a tag', () => {
    expect(normalizeTags([`a${String.fromCharCode(0)}b`])).toEqual({
      ok: false,
      reason: 'invalid_tags',
    });
  });
});

describe('checkRelativePath', () => {
  it.each([
    ['cv.pdf', 'cv.pdf'],
    ['java\\cv.pdf', 'java/cv.pdf'],
    ['./java//cv.pdf', 'java/cv.pdf'],
    ['CV Inglés/Carta Ñandú_.PDF', 'CV Inglés/Carta Ñandú_.PDF'],
    ['carpeta_/x.pdf', 'carpeta_/x.pdf'],
  ])('accepts and canonicalises %s', (input, expected) => {
    expect(checkRelativePath(input)).toEqual({ ok: true, path: expected });
  });

  it.each([
    '../x.pdf',
    '..\\x.pdf',
    'a/../../x.pdf',
    'a/..\\x.pdf',
    '/etc/x.pdf',
    '\\x.pdf',
    '\\\\server\\share\\x.pdf',
    '//server/share/x.pdf',
    'C:\\x.pdf',
    'c:x.pdf',
    'a/b:stream.pdf',
    `a${String.fromCharCode(0)}.pdf`,
    'a\n.pdf',
    '',
    '   ',
    '.',
    'a/CON.pdf',
    'nul.pdf',
    'com1/x.pdf',
    `${'x'.repeat(2000)}.pdf`,
  ])('refuses %j as invalid_path', (input) => {
    expect(checkRelativePath(input)).toEqual({ ok: false, reason: 'invalid_path' });
  });

  it('refuses non-strings', () => {
    for (const value of [undefined, null, 3, {}, ['a.pdf']]) {
      expect(checkRelativePath(value)).toEqual({ ok: false, reason: 'invalid_path' });
    }
  });

  it.each(['a.pdf.exe', 'a', 'a.txt', 'a/.pdf', 'a.pdf.', 'a.pdf '])(
    'refuses %j as not_pdf',
    (input) => {
      expect(checkRelativePath(input)).toEqual({ ok: false, reason: 'not_pdf' });
    },
  );

  it('compares keys case-insensitively and separator-insensitively', () => {
    expect(relativePathKey('Java\\CV.PDF')).toBe(relativePathKey('java/cv.pdf'));
  });
});

describe('validateCvModelDraft', () => {
  it('accepts a valid draft and normalises it', () => {
    const result = validateCvModelDraft({ ...VALID, name: '  CV Java  ', note: '  nota  ' });
    expect(result).toEqual({
      ok: true,
      draft: {
        name: 'CV Java',
        kind: 'cv',
        language: 'es',
        tags: ['java', 'spring boot'],
        relativePath: 'java/cv.pdf',
        note: 'nota',
      },
    });
  });

  it('omits an empty note', () => {
    const result = validateCvModelDraft({ ...VALID, note: '   ' });
    expect(result.ok && 'note' in result.draft).toBe(false);
  });

  it('refuses a non-object input', () => {
    for (const value of [null, undefined, 'x', 3, []]) {
      expect(validateCvModelDraft(value)).toEqual({ ok: false, reason: 'invalid_input' });
    }
  });

  it.each([
    [{ name: '' }, 'invalid_name'],
    [{ name: '   ' }, 'invalid_name'],
    [{ name: 3 }, 'invalid_name'],
    [{ name: 'x'.repeat(121) }, 'invalid_name'],
    [{ name: 'a\u0007b' }, 'invalid_name'],
    [{ kind: 'resume' }, 'invalid_kind'],
    [{ kind: undefined }, 'invalid_kind'],
    [{ language: 'fr' }, 'invalid_language'],
    [{ language: 5 }, 'invalid_language'],
    [{ tags: 'java' }, 'invalid_tags'],
    [{ note: 'x'.repeat(501) }, 'invalid_note'],
    [{ note: 5 }, 'invalid_note'],
    [{ relativePath: '../x.pdf' }, 'invalid_path'],
    [{ relativePath: 'x.txt' }, 'not_pdf'],
  ])('refuses %j as %s', (override, reason) => {
    expect(validateCvModelDraft({ ...VALID, ...override })).toEqual({ ok: false, reason });
  });

  it('accepts boundary lengths', () => {
    expect(
      validateCvModelDraft({ ...VALID, name: 'x'.repeat(120), note: 'y'.repeat(500) }).ok,
    ).toBe(true);
  });

  it('allows line breaks in the note only', () => {
    expect(validateCvModelDraft({ ...VALID, note: 'a\nb' }).ok).toBe(true);
    expect(validateCvModelDraft({ ...VALID, name: 'a\nb' })).toEqual({
      ok: false,
      reason: 'invalid_name',
    });
  });
});

describe('validateCvModelPatch', () => {
  it('accepts a partial patch and ignores a tampered path or id', () => {
    const result = validateCvModelPatch({
      name: ' Nuevo ',
      relativePath: '../../secret.pdf',
      id: 'other',
      registeredAt: 'x',
    });
    expect(result).toEqual({ ok: true, patch: { name: 'Nuevo' } });
  });

  it('turns a blank note into an explicit clear', () => {
    expect(validateCvModelPatch({ note: '  ' })).toEqual({ ok: true, patch: { note: null } });
  });

  it('refuses the same invalid values as a draft', () => {
    expect(validateCvModelPatch({ kind: 'x' })).toEqual({ ok: false, reason: 'invalid_kind' });
    expect(validateCvModelPatch({ tags: ['a', 1] })).toEqual({ ok: false, reason: 'invalid_tags' });
    expect(validateCvModelPatch('x')).toEqual({ ok: false, reason: 'invalid_input' });
  });
});
