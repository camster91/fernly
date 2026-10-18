// Release gate: fails if any meditation audio is still a tiny placeholder or
// missing. Run with `npx tsx scripts/check-audio.ts`. Not part of `npm run ci`
// (placeholders must still pass normal CI); the release workflow runs it.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sessions } from '../src/data/sessions';
import { findPlaceholderAudio } from './check-audio-lib';

const MIN_BYTES = 20 * 1024;
const dir = join(__dirname, '..', 'assets', 'audio');

const files = readdirSync(dir)
  .filter((n) => n.endsWith('.m4a'))
  .map((name) => ({ name, bytes: statSync(join(dir, name)).size }));

const placeholders = findPlaceholderAudio(files, MIN_BYTES);
const missing = sessions.filter((s) => !existsSync(join(dir, `${s.id}.m4a`))).map((s) => s.id);

if (placeholders.length === 0 && missing.length === 0) {
  console.log(`Audio OK: ${files.length} files, all at least ${MIN_BYTES} bytes.`);
  process.exit(0);
}

console.error('Release blocked: audio is not ready.');
if (placeholders.length > 0) {
  console.error(`\nPlaceholder audio (smaller than ${MIN_BYTES} bytes):`);
  for (const n of placeholders) console.error(`  - assets/audio/${n}`);
}
if (missing.length > 0) {
  console.error('\nCatalog sessions with no audio file:');
  for (const id of missing) console.error(`  - assets/audio/${id}.m4a`);
}
console.error('\nGenerate real audio first: see "Generating audio" in README.md.');
process.exit(1);
