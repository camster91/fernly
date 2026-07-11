// Crisis modal — appears as an overlay over the chat when detectCrisis fires.
// The user MUST tap one of the resources or dismiss; there is no path
// forward to the chat without acknowledging.
//
// Why modal (not inline): when someone is in distress, the AI's voice
// shouldn't get a chance to respond. The modal is a hard stop.
//
// Why no auto-dismiss: even if the user "feels better" in 10 seconds,
// we don't trust the AI to read that. They have to choose to close it.
import React from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space, type as t, radius } from '../theme';
import { crisisResourcesFor } from '../safety/crisis';

interface Props {
  visible: boolean;
  locale?: string;
  matchedPhrase?: string;
  onDismiss: () => void;
}

export function CrisisModal({ visible, locale, matchedPhrase, onDismiss }: Props) {
  const resources = crisisResourcesFor(locale);

  function open(resource: typeof resources[number]) {
    if (resource.phone) Linking.openURL(`tel:${resource.phone.replace(/\s/g, '')}`);
    else if (resource.text) Linking.openURL(`sms:741741&body=HOME`);
    else if (resource.url) Linking.openURL(resource.url);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
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
            I'm an AI. I can't help in the way you deserve right now — and the person best placed to help is one tap away.
          </Text>

          <View style={styles.resources}>
            {resources.map((r, i) => (
              <Pressable
                key={i}
                onPress={() => open(r)}
                style={({ pressed }) => [styles.resourceBtn, i === 0 && styles.resourceBtnPrimary, pressed && { opacity: 0.8 }]}
              >
                <Text style={[styles.resourceText, i === 0 && styles.resourceTextPrimary]}>{r.name}</Text>
                {(r.phone || r.text) && (
                  <Text style={[styles.resourceSub, i === 0 && { color: colors.paper }]}>
                    {r.phone ? `Call ${r.phone}` : `Text ${r.text}`}
                  </Text>
                )}
              </Pressable>
            ))}
          </View>

          <Pressable onPress={onDismiss} style={styles.close}>
            <Text style={styles.closeText}>I'm safe for now</Text>
          </Pressable>

          {matchedPhrase && (
            <Text style={styles.matched}>— triggered by: "{matchedPhrase}" —</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(42, 36, 56, 0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:     { backgroundColor: colors.paper, borderRadius: radius.xl, padding: 28, maxWidth: 340, width: '100%' },
  iconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.rose50, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 },
  icon:     { fontSize: 26 },
  title:    { ...t.title, fontSize: 22, color: colors.text, textAlign: 'center', marginBottom: 6 },
  subtitle: { ...t.body, fontWeight: '700', color: colors.warn, textAlign: 'center', marginBottom: 12 },
  body:     { ...t.small, color: colors.textSoft, textAlign: 'center', lineHeight: 20, marginBottom: 20 },

  resources: { gap: 8, marginBottom: 16 },
  resourceBtn:       { padding: 14, borderRadius: radius.md, backgroundColor: colors.paper2, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  resourceBtnPrimary: { backgroundColor: colors.warn, borderColor: colors.warn },
  resourceText:      { fontWeight: '700', fontSize: 14, color: colors.text },
  resourceTextPrimary:{ color: colors.paper },
  resourceSub:       { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: 'Menlo' },

  close:    { paddingVertical: 12, alignItems: 'center' },
  closeText: { ...t.small, fontWeight: '700', color: colors.textMuted },

  matched:  { fontSize: 10, color: colors.ink4, fontFamily: 'Menlo', textAlign: 'center', marginTop: 12, letterSpacing: 0.5 },
});