import { describe, expect, it } from 'vitest';
import { htmlToPlainText } from '../../../src/adapters/boards/html-text.js';

/**
 * These descriptions arrive as API-provided FIELDS, not as scraped pages, so
 * turning them into text is a decoding concern - not a parsing one. No HTML
 * parser dependency is involved or wanted.
 *
 * Two real escaping styles have to survive here:
 *  - Ashby / Lever send real HTML  (`<p>hola</p>`)
 *  - Greenhouse sends ESCAPED HTML (`&lt;p&gt;hola&lt;/p&gt;`)
 */
describe('htmlToPlainText', () => {
  it('returns plain text untouched', () => {
    expect(htmlToPlainText('Junior developer wanted')).toBe('Junior developer wanted');
  });

  it('strips real HTML tags', () => {
    expect(htmlToPlainText('<p>We use <strong>React</strong> and TypeScript.</p>')).toBe(
      'We use React and TypeScript.',
    );
  });

  it('strips Greenhouse-style escaped HTML', () => {
    expect(htmlToPlainText('&lt;p&gt;We use &lt;strong&gt;React&lt;/strong&gt;.&lt;/p&gt;')).toBe(
      'We use React.',
    );
  });

  it('decodes named and numeric entities', () => {
    expect(htmlToPlainText('R&amp;D &quot;team&quot; &#39;now&#39; &nbsp;go')).toBe(
      `R&D "team" 'now' go`,
    );
  });

  it('keeps a paragraph boundary as a line break instead of gluing words', () => {
    expect(htmlToPlainText('<p>Requisitos</p><p>React</p>')).toBe('Requisitos\nReact');
  });

  it('turns list items and line breaks into separate lines', () => {
    expect(htmlToPlainText('<ul><li>React</li><li>Node</li></ul>')).toBe('React\nNode');
    expect(htmlToPlainText('React<br/>Node')).toBe('React\nNode');
  });

  it('never glues two words together when a tag separated them', () => {
    expect(htmlToPlainText('<span>Java</span><span>Script</span>')).toBe('Java Script');
  });

  it('drops script and style bodies instead of scoring their contents', () => {
    expect(htmlToPlainText('<p>React</p><script>var x = "Python";</script>')).toBe('React');
    expect(htmlToPlainText('<style>.a{color:red}</style><p>Node</p>')).toBe('Node');
  });

  it('collapses runaway whitespace so the scorer sees one clean haystack', () => {
    expect(htmlToPlainText('<p>React</p>\n\n\n\n<p>Node</p>   ')).toBe('React\nNode');
  });

  it('handles an empty or whitespace-only description', () => {
    expect(htmlToPlainText('')).toBe('');
    expect(htmlToPlainText('   \n  ')).toBe('');
  });

  it('leaves a lone ampersand alone rather than corrupting the text', () => {
    expect(htmlToPlainText('Sales & Marketing')).toBe('Sales & Marketing');
  });

  it('does not decode twice when the text legitimately mentions an entity', () => {
    // Single-escaped: `&amp;lt;` means the literal text "&lt;", not a tag.
    expect(htmlToPlainText('<p>Type &amp;lt;div&amp;gt; to start</p>')).toBe(
      'Type &lt;div&gt; to start',
    );
  });
});
