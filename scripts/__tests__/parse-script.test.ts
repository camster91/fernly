import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScript } from '../parse-script';

describe('parseScript', () => {
  it('returns one speech part for text only', () => {
    expect(parseScript('Hello there.')).toEqual([{ kind: 'speech', text: 'Hello there.' }]);
  });

  it('parses a pause line', () => {
    expect(parseScript('One.\n\n[pause 10s]\n\nTwo.')).toEqual([
      { kind: 'speech', text: 'One.' },
      { kind: 'pause', seconds: 10 },
      { kind: 'speech', text: 'Two.' },
    ]);
  });

  it('merges adjacent text lines, keeping paragraph breaks', () => {
    expect(parseScript('One.\n\nTwo.\nThree.')).toEqual([
      { kind: 'speech', text: 'One.\n\nTwo.\nThree.' },
    ]);
  });

  it('ignores blank lines and surrounding whitespace', () => {
    expect(parseScript('\n\n  \n  Hi.  \n\n[pause 2s]  \n\n')).toEqual([
      { kind: 'speech', text: 'Hi.' },
      { kind: 'pause', seconds: 2 },
    ]);
  });

  it('throws naming the line for [pause 0s]', () => {
    expect(() => parseScript('Hi.\n[pause 0s]')).toThrow(/line 2/);
  });

  it('throws naming the line for malformed pauses', () => {
    expect(() => parseScript('Hi.\n\nHi.\n[pause x]')).toThrow(/line 4/);
    expect(() => parseScript('[pause 5]')).toThrow(/line 1/);
    expect(() => parseScript('[pause 2.5s]')).toThrow(/line 1/);
  });

  it('parses every real script into at least one speech part', () => {
    const dir = join(__dirname, '..', '..', 'content', 'scripts');
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const parts = parseScript(readFileSync(join(dir, f), 'utf8'));
      expect(
        parts.some((p) => p.kind === 'speech'),
        f,
      ).toBe(true);
    }
  });
});
