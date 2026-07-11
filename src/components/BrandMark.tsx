// Brand mark — fern frond illustration
// Used in the page header and splash. Single SVG, scales cleanly.
import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

interface Props {
  size?: number;
  variant?: 'color' | 'ink' | 'paper';
}

export function BrandMark({ size = 28, variant = 'color' }: Props) {
  const primary = variant === 'color' ? colors.lavender500 : variant === 'paper' ? colors.paper : colors.ink;
  const accent1 = variant === 'color' ? colors.mint300    : variant === 'paper' ? colors.lavender300 : colors.ink;
  const accent2 = variant === 'color' ? colors.lavender700 : variant === 'paper' ? colors.paper : colors.ink;

  // Fiddlehead + 5 leaflet branches. Single-path spiral + 5 fronds.
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Path
        d="M 50 78 C 50 65, 28 65, 28 52 C 28 38, 52 38, 52 52 C 52 64, 38 64, 38 54 C 38 46, 48 46, 48 52"
        stroke={primary}
        strokeWidth={10}
        strokeLinecap="round"
      />
      <Path d="M 32 50 Q 22 48 16 46" stroke={accent1} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 28 42 Q 18 38 12 34" stroke={primary} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 28 60 Q 18 62 14 64" stroke={primary} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 36 38 Q 32 32 28 28" stroke={accent2} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 44 38 Q 44 30 46 24" stroke={accent2} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 52 50 Q 62 50 70 46" stroke={accent1} strokeWidth={7} strokeLinecap="round" />
    </Svg>
  );
}

export function BrandLockup({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size * 3.2} height={size} viewBox="0 0 320 100" fill="none">
      <Path
        d="M 50 78 C 50 65, 28 65, 28 52 C 28 38, 52 38, 52 52 C 52 64, 38 64, 38 54 C 38 46, 48 46, 48 52"
        stroke={colors.lavender500}
        strokeWidth={10}
        strokeLinecap="round"
      />
      <Path d="M 32 50 Q 22 48 16 46" stroke={colors.mint300} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 28 42 Q 18 38 12 34" stroke={colors.lavender500} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 28 60 Q 18 62 14 64" stroke={colors.lavender500} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 36 38 Q 32 32 28 28" stroke={colors.lavender700} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 44 38 Q 44 30 46 24" stroke={colors.lavender700} strokeWidth={7} strokeLinecap="round" />
      <Path d="M 52 50 Q 62 50 70 46" stroke={colors.mint300} strokeWidth={7} strokeLinecap="round" />
    </Svg>
  );
}