// Pure helper for the release audio gate (see check-audio.ts).

/** Names of files whose size is below `minBytes` (i.e. placeholder audio). */
export function findPlaceholderAudio(
  files: { name: string; bytes: number }[],
  minBytes: number,
): string[] {
  return files.filter((f) => f.bytes < minBytes).map((f) => f.name);
}
