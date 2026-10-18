// Crisis help modal — opened by the "Need help now?" button (HelpButton) that
// appears on every tab. It lists free, confidential helplines for the user's
// locale and can be closed at any time with the Close button (or Android back).
//
//   - Locale wiring via expo-localization. Crisis resources match the
//     user's device locale (en-US, en-GB, es, fr, pt, de, fallback IASP).
//   - Open failures show inline guidance: a tap must not silently no-op.
//     (No canOpenURL pre-check — on Android 11+ it returns false for
//     tel:/sms: unless the manifest declares them.)
//   - SMS URL uses Platform.OS branch (iOS '&body=' vs Android '?body=').
//   - Reachability banner warns when crisis-resource URLs are stale.
import React, { useEffect, useMemo, useState } from 'react';
import { getLocales } from 'expo-localization';
import {
  AccessibilityInfo,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, type as t, radius } from '../theme';
import { crisisResourcesFor, lastVerifiedAt } from '../safety/crisis';

interface Props {
  visible: boolean;
  /** Optional override. When omitted, derived from device locale via expo-localization. */
  locale?: string;
  onDismiss: () => void;
}

// 7 days in ms — banner triggers if no HEAD-check has succeeded in this window.
const REACHABILITY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Pick the best locale for crisis resources from the device's preferred
 * locales. The crisis module routes by region (US, CA, GB, …), then language.
 *
 * v0.9: cached at module load via `MEMOIZED_PICKED_LOCALE` so every
 * CrisisModal render doesn't re-call `getLocales()`. On Render the
 * language detection is a single constant lookup. The `locale` prop
 * still wins when the caller passes it explicitly (testing, i18n
 * override).
 * See plans/05 P1-4 / P1-11. */
const MEMOIZED_PICKED_LOCALE = (() => {
  try {
    const locales = getLocales();
    for (const l of locales) {
      const tag = l.languageTag || `${l.languageCode}-${l.regionCode ?? ''}`;
      if (tag) return tag;
    }
  } catch {
    // expo-localization failed to load — fall through to default
  }
  return 'en-US';
})();
const pickLocale = () => MEMOIZED_PICKED_LOCALE;

export function CrisisModal({ visible, locale, onDismiss }: Props) {
  // If the caller didn't pass a locale, derive from the device prefs.
  // Pinned at mount — we don't re-render on OS locale changes mid-modal.
  const effectiveLocale = locale ?? pickLocale();
  // Memoized: `resources` is an effect dependency; a fresh array on every
  // render would re-run the effect (and re-announce).
  const resources = useMemo(() => crisisResourcesFor(effectiveLocale), [effectiveLocale]);
  const [openError, setOpenError] = useState<string | null>(null);
  const [unreachableBanner, setUnreachableBanner] = useState(false);

  // Decide banner state on mount/visibility change. Also announce the
  // modal opening to VoiceOver/TalkBack so screen-reader users don't
  // have to swipe to discover it.
  useEffect(() => {
    if (!visible) {
      setOpenError(null);
      return;
    }
    const now = Date.now();
    const hasFresh = resources.some((r) => {
      if (!r.url) return true; // phone/text resources don't need a HEAD check
      const v = lastVerifiedAt(r.url);
      return v !== null && now - v < REACHABILITY_STALE_MS;
    });
    setUnreachableBanner(!hasFresh);

    // Screen-reader announcement. Only fire once per modal open —
    // visibility-driven re-runs (e.g. parent re-renders) shouldn't
    // re-announce. We use the cleanup to noop; if visible flips false
    // and back true, the announcement fires again which is what we want.
    AccessibilityInfo.announceForAccessibility(
      'Help is available. Choose a helpline below, or use the Close button when you are done.',
    );
  }, [visible, resources]);

  async function open(resource: (typeof resources)[number]) {
    setOpenError(null);
    try {
      let url: string | null = null;
      if (resource.phone) {
        url = `tel:${resource.phone.replace(/\s/g, '')}`;
      } else if (resource.text) {
        // `&body=` is iOS; Android needs `?body=`. Branch on platform.
        // resource.text is "<body> to <number>", e.g. "HOME to 741741".
        const [body, number] = resource.text.split(' to ');
        const bodyParam = Platform.OS === 'ios' ? '&' : '?';
        url = `sms:${number.replace(/\s/g, '')}${bodyParam}body=${encodeURIComponent(body)}`;
      } else if (resource.url) {
        url = resource.url;
      }
      if (!url) return;

      // Open directly; openURL rejects when nothing can handle the URL.
      await Linking.openURL(url);
    } catch {
      setOpenError(
        `This device can't open ${resource.name}. ` +
          (resource.phone
            ? `Call ${resource.phone} from another phone, or try another resource below.`
            : resource.text
              ? `Text ${resource.text} from another device, or try another resource below.`
              : `Visit ${resource.url} in a browser, or try another resource below.`),
      );
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      // accessibilityViewIsModal keeps screen-reader focus inside the modal
      // until it is closed. Android back closes it via onRequestClose.
      accessibilityViewIsModal={true}
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>💛</Text>
          </View>
          <Text style={styles.title}>You matter.</Text>
          <Text style={styles.subtitle}>You don't have to go through this alone.</Text>
          <Text style={styles.body}>
            If you're struggling or not safe right now, talking to someone can help. These lines are
            free and confidential.
          </Text>

          {unreachableBanner && (
            <View
              style={styles.banner}
              accessible={true}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              accessibilityLabel="Warning: helpline resources may be temporarily unavailable on this device. If a button fails, try another."
            >
              <Text style={styles.bannerText}>
                ⚠️ Resources may be temporarily unavailable on this device. If a button fails, try
                another.
              </Text>
            </View>
          )}

          {openError && (
            <View
              style={styles.errorBanner}
              accessible={true}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
            >
              <Text style={styles.errorText}>{openError}</Text>
            </View>
          )}

          <View style={styles.resources}>
            {resources.map((r, i) => {
              // Compose a label that distinguishes phone/text/url resources
              // for screen readers. The visible text alone ("988 Suicide &
              // Crisis Lifeline (US)") is ambiguous when announced.
              const action = r.phone
                ? `Call ${r.phone}`
                : r.text
                  ? `Text ${r.text}`
                  : r.url
                    ? `Visit ${r.url}`
                    : '';
              return (
                <Pressable
                  key={i}
                  onPress={() => open(r)}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.name}. ${action}`}
                  accessibilityHint={
                    r.phone
                      ? 'Opens your phone app to dial this number.'
                      : r.text
                        ? 'Opens your messaging app to send a text.'
                        : 'Opens in your browser.'
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                  style={({ pressed }) => [
                    styles.resourceBtn,
                    i === 0 && styles.resourceBtnPrimary,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={[styles.resourceText, i === 0 && styles.resourceTextPrimary]}>
                    {r.name}
                  </Text>
                  {(r.phone || r.text) && (
                    <Text style={[styles.resourceSub, i === 0 && { color: colors.paper }]}>
                      {r.phone ? `Call ${r.phone}` : `Text ${r.text}`}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityHint="Closes the help screen"
            style={styles.close}
          >
            <Text style={styles.closeText}>Close</Text>
          </Pressable>

          {/*
            Matched-phrase debug line REMOVED in v0.7 (was P0 a11y #8).
            Surfacing the user's exact crisis phrasing back to them in a
            10pt, 1.93:1 contrast label was a re-traumatization risk per
            clinical crisis UX literature, and a screen-reader pitfall
            (no role, no label, near-illegible contrast). Dev-only opt-in
            could be added later behind a feature flag; for v0 we drop it.
          */}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.paper,
    borderRadius: radius.xl,
    padding: 28,
    maxWidth: 340,
    width: '100%',
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.rose50,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  icon: { fontSize: 26 },
  title: { ...t.title, fontSize: 22, color: colors.text, textAlign: 'center', marginBottom: 6 },
  subtitle: {
    ...t.body,
    fontWeight: '700',
    color: colors.warn,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    ...t.small,
    color: colors.textSoft,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },

  banner: {
    backgroundColor: colors.yellow100,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
  },
  bannerText: { ...t.small, color: colors.text, textAlign: 'center' },
  errorBanner: {
    backgroundColor: colors.rose50,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { ...t.small, color: colors.warn, textAlign: 'center' },

  resources: { gap: 8, marginBottom: 16 },
  resourceBtn: {
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.paper2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    // WCAG 2.5.5: minimum 44pt tap target. With 14px vertical padding
    // plus a 14pt text line, the natural height is ~46pt — add an
    // explicit minHeight as a belt-and-suspenders guarantee against
    // font scaling pushing the height below threshold.
    minHeight: 56,
  },
  // v0.8: use warnDeep (#C92A4A) — paper foreground on warnDeep measures
  // ~5.0:1, clears WCAG AA-body 4.5:1. The previous warn (#E55D75) was
  // 3.25:1 — failed AA. The architectural fix was supposed to ship in
  // PR UX3 (theme.ts added warnDeep) but the CrisisModal never switched
  // over. See plans/05-full-codebase-review-2026-07-22.md P0-3.
  resourceBtnPrimary: { backgroundColor: colors.warnDeep, borderColor: colors.warnDeep },
  resourceText: { fontWeight: '700', fontSize: 14, color: colors.text },
  // Primary CTA foreground was colors.paper on colors.warn (3.25:1, fails
  // AA-body 4.5:1). Switch to white on a slightly darker warn shade so
  // the most-tapped button in crisis is readable in any lighting. Theme
  // token change cascades here — see PR4 for theme.ts update.
  // Primary CTA foreground was colors.paper on colors.warn (3.25:1, fails
  // AA-body 4.5:1). The architectural fix is in PR4 (theme.ts: darken
  // colors.warn to a deeper rose, then this foreground will read ≥4.6:1
  // on the new background). For now we keep colors.paper and rely on
  // the 56pt minHeight + hitSlop on the button to compensate.
  resourceTextPrimary: { color: colors.paper },
  resourceSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    fontFamily: 'Menlo',
  },

  close: {
    minHeight: 44,
    minWidth: 44,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  closeText: { ...t.bodyBold, color: colors.text },
});
