/**
 * One-time, dev-only: turn content/scripts/<id>.md into assets/audio/<id>.m4a.
 *
 * Usage: OPENAI_API_KEY=... npx tsx scripts/generate-audio.ts [session-id]
 * Requires ffmpeg and ffprobe on PATH. Prints "<id> <durationSec>" per session.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseScript } from './parse-script';

const ROOT = resolve(__dirname, '..');
const SCRIPTS_DIR = join(ROOT, 'content', 'scripts');
const OUT_DIR = join(ROOT, 'assets', 'audio');

const ENDPOINT = 'https://api.openai.com/v1/audio/speech';
const MODEL = 'gpt-4o-mini-tts';
const VOICE = 'sage';
const MAX_INPUT_CHARS = 4096;
const INSTRUCTIONS = 'Speak slowly, softly and calmly, like a gentle meditation guide.';
const SAMPLE_RATE = 24000;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function hasBinary(name: string): boolean {
  return spawnSync(name, ['-version'], { stdio: 'ignore' }).status === 0;
}

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed (${r.status}): ${r.stderr?.slice(-500)}`);
  }
  return r.stdout;
}

/** Split text into chunks <= max chars at paragraph boundaries (sentence/hard split as fallback). */
export function chunkText(text: string, max = MAX_INPUT_CHARS): string[] {
  const pieces: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    if (para.length <= max) {
      pieces.push(para);
      continue;
    }
    let cur = '';
    for (const s of para.split(/(?<=[.!?])\s+/)) {
      for (let i = 0; i < s.length; i += max) {
        const sub = s.slice(i, i + max);
        if (cur && cur.length + 1 + sub.length > max) {
          pieces.push(cur);
          cur = sub;
        } else {
          cur = cur ? `${cur} ${sub}` : sub;
        }
      }
    }
    if (cur) pieces.push(cur);
  }
  const chunks: string[] = [];
  let cur = '';
  for (const p of pieces) {
    if (cur && cur.length + 2 + p.length > max) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** The only provider call: text (<= 4096 chars) in, WAV bytes out. */
async function synthesize(text: string): Promise<Buffer> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      voice: VOICE,
      input: text,
      instructions: INSTRUCTIONS,
      response_format: 'wav',
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI speech request failed: ${res.status} ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function generate(id: string, tmp: string): Promise<number> {
  const parts = parseScript(readFileSync(join(SCRIPTS_DIR, `${id}.md`), 'utf8'));
  const segments: string[] = [];
  let n = 0;
  for (const part of parts) {
    if (part.kind === 'pause') {
      const file = join(tmp, `${id}-${n++}.wav`);
      run('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=${SAMPLE_RATE}:cl=mono`,
        '-t',
        String(part.seconds),
        '-c:a',
        'pcm_s16le',
        file,
      ]);
      segments.push(file);
      continue;
    }
    for (const chunk of chunkText(part.text)) {
      const raw = join(tmp, `${id}-${n}-raw.wav`);
      const file = join(tmp, `${id}-${n++}.wav`);
      writeFileSync(raw, await synthesize(chunk));
      // Normalise so every segment shares format for the concat demuxer.
      run('ffmpeg', [
        '-y',
        '-loglevel',
        'error',
        '-i',
        raw,
        '-ar',
        String(SAMPLE_RATE),
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        file,
      ]);
      segments.push(file);
    }
  }
  const list = join(tmp, `${id}-list.txt`);
  writeFileSync(list, segments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${id}.m4a`);
  run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-ac',
    '1',
    '-c:a',
    'aac',
    '-b:a',
    '48k',
    out,
  ]);
  const dur = run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    out,
  ]);
  return Math.round(parseFloat(dur));
}

async function main() {
  if (!process.env.OPENAI_API_KEY) fail('OPENAI_API_KEY is not set.');
  if (!hasBinary('ffmpeg') || !hasBinary('ffprobe')) {
    fail('ffmpeg and ffprobe must be installed and on PATH.');
  }
  const only = process.argv[2];
  const ids = readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => basename(f, '.md'));
  if (only && !ids.includes(only)) fail(`Unknown session id "${only}". Known: ${ids.join(', ')}`);
  const tmp = mkdtempSync(join(tmpdir(), 'fernly-audio-'));
  try {
    for (const id of only ? [only] : ids) {
      console.log(`${id} ${await generate(id, tmp)}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
}
