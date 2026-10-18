// Quoted keys are parsed by the catalog test, hence prettier-ignore below.
// Static audio map (Metro needs literal require() paths). Placeholders until
// the audio generator replaces the files. Kept separate from sessions.ts so
// the catalog stays importable from Node tests.
// prettier-ignore
export const sessionAudio: Record<string, number> = {
  'calm': require('../../assets/audio/calm.m4a'),
  'focus': require('../../assets/audio/focus.m4a'),
  'stress-reset': require('../../assets/audio/stress-reset.m4a'),
  'gratitude': require('../../assets/audio/gratitude.m4a'),
  'sleep-body-scan': require('../../assets/audio/sleep-body-scan.m4a'),
  'sleep-breath-count': require('../../assets/audio/sleep-breath-count.m4a'),
  'sleep-let-go': require('../../assets/audio/sleep-let-go.m4a'),
  'sos-panic': require('../../assets/audio/sos-panic.m4a'),
  'sos-anger': require('../../assets/audio/sos-anger.m4a'),
  'sos-overwhelm': require('../../assets/audio/sos-overwhelm.m4a'),
  'basics-1': require('../../assets/audio/basics-1.m4a'),
  'basics-2': require('../../assets/audio/basics-2.m4a'),
};
