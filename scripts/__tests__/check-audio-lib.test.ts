import { describe, expect, it } from 'vitest';
import { findPlaceholderAudio } from '../check-audio-lib';

describe('findPlaceholderAudio', () => {
  it('returns names of files smaller than the minimum', () => {
    const files = [
      { name: 'calm.m4a', bytes: 1208 },
      { name: 'focus.m4a', bytes: 500_000 },
    ];
    expect(findPlaceholderAudio(files, 20 * 1024)).toEqual(['calm.m4a']);
  });

  it('treats a file exactly at the minimum as real audio', () => {
    expect(findPlaceholderAudio([{ name: 'a.m4a', bytes: 20480 }], 20480)).toEqual([]);
  });

  it('returns an empty list when there are no files', () => {
    expect(findPlaceholderAudio([], 20480)).toEqual([]);
  });
});
