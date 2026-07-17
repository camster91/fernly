// Crisis modal — appears as an overlay over the chat when detectCrisis fires.
// The user MUST tap one of the resources or complete the safety confirmation;
// there is no path forward to the chat without acknowledging.
//
// v0.5:
//   - Locale wiring via expo-localization. Crisis resources match the
//     user's device locale (en-US, en-GB, es, fr, pt, de, fallback IASP).
//   - canOpenURL guards: a tap during crisis must not silently no-op.
//   - SMS URL uses Platform.OS branch (iOS '&body=' vs Android '?body=').
//   - Reachability banner warns when crisis-resource URLs are stale.
//   - Dismiss requires a 1.5s long-press with visible progress bar.
import React, { useEffect, useRef, useState } from 'react';
import { getLocales } from 'expo-localization';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type as t, radius } from '../theme';
import { crisisResourcesFor, lastVerifiedAt } from '../safety/crisis';

interface Props {
  visible: boolean;
  /** Optional override. When omitted, derived from device locale via expo-localization. */
  locale?: string;
  matchedPhrase?: string;
  onDismiss: () => void;
}

// 7 days in ms — banner triggers if no HEAD-check has succeeded in this window.
const REACHABILITY_STALE_MS = 7 * 24 * 60 * 60 * 1000;

// 1.5s long-press required to dismiss. A single tap, accidental swipe, or
// back gesture cannot close the modal.
const DISMISS_LONGPRESS_MS = 1500;

/** Pick the best locale for crisis resources from the device's preferred
 * locales. The crisis module recognises en-US, en-GB, es, fr, pt, de. */
function pickLocale(): string {
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
}

export function CrisisModal({ visible, locale, matchedPhrase, onDismiss }: Props) {
  // If the caller didn't pass a locale, derive from the device prefs.
  // Pinned at mount — we don't re-render on OS locale changes mid-modal.
  const effectiveLocale = locale ?? pickLocale();
  const resources = crisisResourcesFor(effectiveLocale);
  const [openError, setOpenError] = useState<string | null>(null);
  const [unreachableBanner, setUnreachableBanner] = useState(false);

  // Long-press state for the dismiss button.
  const [pressing, setPressing] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Decide banner state on mount/visibility change.
  useEffect(() => {
    if (!visible) {
      setOpenError(null);
      setPressing(false);
      setHoldProgress(0);
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
      return;
    }
    const now = Date.now();
    const hasFresh = resources.some((r) => {
      if (!r.url) return true; // phone/text resources don't need a HEAD check
      const v = lastVerifiedAt(r.url);
      return v !== null && now - v < REACHABILITY_STALE_MS;
    });
    setUnreachableBanner(!hasFresh);
  }, [visible, resources]);

  function startHold() {
    setPressing(true);
    setHoldProgress(0);
    const start = Date.now();
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / DISMISS_LONGPRESS_MS) * 100);
      setHoldProgress(pct);
      if (pct >= 100) {
        if (holdTimerRef.current) clearInterval(holdTimerRef.current);
        setPressing(false);
        setHoldProgress(0);
        onDismiss();
      }
    }, 50);
  }

  function cancelHold() {
    if (holdTimerRef.current) clearInterval(holdTimerRef.current);
    setPressing(false);
    setHoldProgress(0);
  }

  async function open(resource: (typeof resources)[number]) {
    setOpenError(null);
    try {
      let url: string | null = null;
      if (resource.phone) {
        url = `tel:${resource.phone.replace(/\s/g, '')}`;
      } else if (resource.text) {
        // `&body=` is iOS; Android needs `?body=`. Branch on platform.
        const bodyParam = Platform.OS === 'ios' ? '&' : '?';
        url = `sms:741741${bodyParam}body=${encodeURIComponent(resource.text.split(' to ')[0])}`;
      } else if (resource.url) {
        url = resource.url;
      }
      if (!url) return;

      // canOpenURL check first — fail loudly with inline guidance.
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        setOpenError(
          `This device can't open ${resource.name}. ` +
            (resource.phone
              ? `Call ${resource.phone} from another phone, or text HOME to 741741.`
              : resource.text
                ? `Text HOME to 741741 from another device.`
                : `Visit the URL in a browser.`),
        );
        return;
      }
      await Linking.openURL(url);
    } catch {
      setOpenError(
        `Couldn't open ${resource.name}. Try a different resource or call 988 directly.`,
      );
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* No onRequestClose — Android back / iOS swipe-down cannot dismiss.
          The user MUST complete the long-press on the dismiss button. */}
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Text style={styles.icon}>💛</Text>
          </View>
          <Text style={styles.title}>You matter.</Text>
          <Text style={styles.subtitle}>
            Right now, please reach out to a human trained for this.
          </Text>
          <Text style={styles.body}>
            I'm an AI. I can't help in the way you deserve right now — and the person best placed to
            help is one tap away.
          </Text>

          {unreachableBanner && (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>
                ⚠️ Resources may be temporarily unavailable on this device. If a button fails, try
                another.
              </Text>
            </View>
          )}

          {openError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{openError}</Text>
            </View>
          )}

          <View style={styles.resources}>
            {resources.map((r, i) => (
              <Pressable
                key={i}
                onPress={() => open(r)}
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
            ))}
          </View>

          {/* Long-press dismiss — single tap cannot close the modal. */}
          <Pressable onPressIn={startHold} onPressOut={cancelHold} style={styles.close}>
            <Text style={styles.closeText}>
              {pressing
                ? `Keep holding… ${Math.round(DISMISS_LONGPRESS_MS / 1000 - (holdProgress / 100) * (DISMISS_LONGPRESS_MS / 1000))}s`
                : "Hold to confirm you're safe for now"}
            </Text>
            <View style={styles.holdTrack}>
              <View style={[styles.holdFill, { width: `${holdProgress}%` }]} />
            </View>
          </Pressable>

          {matchedPhrase && <Text style={styles.matched}>— triggered by: "{matchedPhrase}" —</Text>}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(42, 36, 56, 0.85)',
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
  },
  resourceBtnPrimary: { backgroundColor: colors.warn, borderColor: colors.warn },
  resourceText: { fontWeight: '700', fontSize: 14, color: colors.text },
  resourceTextPrimary: { color: colors.paper },
  resourceSub: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: 'Menlo' },

  close: { paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center' },
  closeText: { ...t.small, fontWeight: '700', color: colors.textMuted, marginBottom: 6 },
  holdTrack: {
    width: 120,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  holdFill: { height: '100%', backgroundColor: colors.warn },

  matched: {
    fontSize: 10,
    color: colors.ink4,
    fontFamily: 'Menlo',
    textAlign: 'center',
    marginTop: 12,
    letterSpacing: 0.5,
  },
});
