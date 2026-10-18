export type ScriptPart = { kind: 'speech'; text: string } | { kind: 'pause'; seconds: number };

const PAUSE_RE = /^\[pause (\d+)s\]$/;

/**
 * Parse a narration script. A line containing only `[pause Ns]` (N an integer >= 1)
 * is a pause; everything else is speech. Adjacent text lines merge into one speech part.
 */
export function parseScript(md: string): ScriptPart[] {
  const parts: ScriptPart[] = [];
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) parts.push({ kind: 'speech', text });
    buf = [];
  };

  md.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('[pause')) {
      const m = PAUSE_RE.exec(line);
      const seconds = m ? Number(m[1]) : 0;
      if (!m || seconds < 1) {
        throw new Error(
          `Malformed pause on line ${i + 1}: "${line}" (expected "[pause Ns]" with integer N >= 1)`,
        );
      }
      flush();
      parts.push({ kind: 'pause', seconds });
      return;
    }
    buf.push(line);
  });
  flush();
  return parts;
}
