// Brand mark — fern frond illustration.
// v0.2: the integrated BrandMark + BrandLockup components are removed
// because no source file imports them. The SVG path data and color tokens
// are kept here as the design source of truth — re-introduce when the
// brand mark lands in ProfileScreen header / OnboardingScreen / splash.
//
// Production-ready mark needs a real designer. See spec/index.html
// section 01.5 for the full exploration (4 AI-rendered concepts +
// designer brief).
import { colors } from '../theme';

// Fiddlehead + 5 leaflet branches. Single-path spiral + 5 fronds.
export const BRAND_MARK_PATH = {
  primary: 'M 50 78 C 50 65, 28 65, 28 52 C 28 38, 52 38, 52 52 C 52 64, 38 64, 38 54 C 38 46, 48 46, 48 52',
  fronds: [
    'M 32 50 Q 22 48 16 46',   // accent1
    'M 28 42 Q 18 38 12 34',   // primary
    'M 28 60 Q 18 62 14 64',   // primary
    'M 36 38 Q 32 32 28 28',   // accent2
    'M 44 38 Q 44 30 46 24',   // accent2
    'M 52 50 Q 62 50 70 46',   // accent1
  ],
} as const;

// Color tokens used by the brand mark in its default 'color' variant.
export const BRAND_MARK_COLORS = {
  primary: colors.lavender500,
  accent1: colors.mint300,
  accent2: colors.lavender700,
} as const;