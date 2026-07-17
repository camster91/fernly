// Design tokens — Fernly pastel system
// Mirrors the values in fernly-spec/index.html

export const colors = {
  // Pastel palette
  lavender50:  '#F4F1FB',
  lavender100: '#E8E1F5',
  lavender300: '#C9B6E8',
  lavender500: '#9B7DD4',
  lavender700: '#6B4FB0',
  peach50:     '#FFF4ED',
  peach100:    '#FFE3D1',
  peach300:    '#FFB892',
  peach500:    '#F5895A',
  yellow50:    '#FFFAEB',
  yellow100:   '#FFF0C2',
  yellow300:   '#FFDB7A',
  yellow500:   '#E8B72F',
  yellow700:   '#8a6500',
  mint50:      '#EFFAF4',
  mint100:     '#D4F1E2',
  mint300:     '#8FDDB4',
  mint500:     '#5BC492',
  mint700:     '#1c8e58',
  rose50:      '#FFF1F3',
  rose100:     '#FFD9DF',
  rose300:     '#FF9DAB',
  rose500:     '#E55D75',

  // Neutrals
  ink:     '#2A2438',
  ink2:    '#4A4360',
  ink3:    '#7A7390',
  ink4:    '#B8B3C9',
  paper:   '#FBF9F6',
  paper2:  '#FFFFFF',
  line:    '#ECE7F1',

  // Semantic
  bg:        '#FBF9F6',
  text:      '#2A2438',
  textSoft:  '#4A4360',
  textMuted: '#7A7390',
  accent:    '#9B7DD4',
  accentSoft:'#E8E1F5',
  warn:      '#E55D75',
  success:   '#8FDDB4',
} as const;

export const space = {
  s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s7: 32, s8: 40, s9: 48,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  full: 999,
} as const;

// Typography — use system fonts as fallbacks for body, Inter via @expo-google-fonts later
export const font = {
  display: 'System',
  body: 'System',
  mono: 'Menlo',
} as const;

export const type = {
  displayHero: { fontFamily: font.display, fontSize: 38, fontWeight: '800' as const, letterSpacing: -1, lineHeight: 42 },
  displayLg:   { fontFamily: font.display, fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.6, lineHeight: 36 },
  title:       { fontFamily: font.display, fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3, lineHeight: 28 },
  heading:     { fontFamily: font.display, fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 24 },
  body:        { fontFamily: font.body,    fontSize: 16, fontWeight: '400' as const, lineHeight: 24 },
  bodyBold:    { fontFamily: font.body,    fontSize: 16, fontWeight: '700' as const, lineHeight: 22 },
  small:       { fontFamily: font.body,    fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  smallBold:   { fontFamily: font.body,    fontSize: 13, fontWeight: '700' as const, lineHeight: 18 },
  micro:       { fontFamily: font.mono,    fontSize: 11, fontWeight: '500' as const, letterSpacing: 1.2, lineHeight: 14 },
  eyebrow:     { fontFamily: font.mono,    fontSize: 11, fontWeight: '500' as const, letterSpacing: 1.4, lineHeight: 14, textTransform: 'uppercase' as const },
};