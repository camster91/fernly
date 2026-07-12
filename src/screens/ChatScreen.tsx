// Chat — the open beta stub. Real LLM in week 3 of build arc.
// For now: deterministic mock that uses the user's profile tone + mascot
// to produce varied, soft, contextual replies. Reads from AsyncStorage so
// sessions persist between launches.
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { CrisisModal } from '../components/CrisisModal';
import { colors, space, type as t, radius } from '../theme';
import { storage } from '../storage';
import { detectCrisis } from '../safety/crisis';
import type { ChatMessage, ChatSession, CrisisAuditEntry, UserProfile, Tone } from '../types';

// Deterministic mock responder — picks a reply based on user input + their tone.
// NOT an LLM. Replace with real chat backend in build week 3.
function mockReply(input: string, tone: Tone, _mascot: string): string {
  const text = input.toLowerCase();
  const softBank = [
    'That sounds heavy. Want to sit with it for a sec?',
    "I'm here. Take your time.",
    'It makes sense that this is the thing your brain keeps returning to.',
    "What's the smallest part of this that's hardest?",
    "There's no rush. You don't have to fix it today.",
  ];
  const directBank = [
    "Got it. Let's name what's most in the way.",
    "Okay. Three minutes. What's the one thing on your mind?",
    "Pick the top 1 and we'll work just that.",
    "Let's try a thought record on this. Five minutes.",
  ];
  const playfulBank = [
    'lol okay so your brain is doing the thing again. wanna poke it?',
    'sounds like the vibes are off. what changed?',
    'mood: ✨frazzled✨ — what would help right now, a chat or a tool?',
  ];
  const bank = tone === 'soft' ? softBank : tone === 'direct' ? directBank : playfulBank;
  // Stable hash → bank index
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return bank[Math.abs(h) % bank.length];
}

export function ChatScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [recording, setRecording] = useState(false);
  const [crisisVisible, setCrisisVisible] = useState(false);
  const [crisisMatched, setCrisisMatched] = useState<string | undefined>();
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    (async () => {
      const p = await storage.getProfile();
      setProfile(p);
      const chats = await storage.getChats();
      const latest = chats[0];
      if (latest) setMessages(latest.messages);
    })();
  }, []);

  async function send() {
    const text = input.trim();
    if (!text) return;

    // CRISIS CHECK FIRST. If hard, the modal wins, the LLM never sees this.
    const verdict = detectCrisis(text);
    if (verdict.level === 'hard') {
      const userMsg: ChatMessage = {
        id: String(Date.now()),
        role: 'user',
        text,
        at: new Date().toISOString(),
      };
      const blocked: ChatMessage = {
        id: String(Date.now() + 1),
        role: 'fernly',
        text: '[crisis modal shown — AI response suppressed]',
        at: new Date().toISOString(),
      };
      setMessages((m) => [...m, userMsg, blocked]);
      setInput('');
      setCrisisMatched(verdict.matchedPhrase);
      setCrisisVisible(true);
      // Persist chat history (encrypted via SecureStore in storage.ts).
      const session: ChatSession = {
        id: String(Date.now()),
        startedAt: new Date().toISOString(),
        messages: [...messages, userMsg, blocked],
      };
      await storage.addChat(session);
      // Separately, append a crisis audit entry. This survives clearAll()
      // — it's the incident-response trail. Stored in encrypted SecureStore,
      // schema-versioned via CrisisAuditEntry.version.
      const audit: CrisisAuditEntry = {
        version: 1,
        id: `${Date.now()}-audit`,
        at: new Date().toISOString(),
        severity: 'hard',
        matchedPhrase: verdict.matchedPhrase,
      };
      await storage.appendCrisisAudit(audit);
      return;
    }

    // Soft signals still go to the AI; we log a flag in the crisis audit
    // log (separately from chat history) for future pattern tracking.
    // (v1: surface this as "we noticed something heavy" check-in after the convo.)
    if (verdict.level === 'soft' && verdict.matchedPhrase) {
      const softAudit: CrisisAuditEntry = {
        version: 1,
        id: `${Date.now()}-audit`,
        at: new Date().toISOString(),
        severity: 'soft',
        matchedPhrase: verdict.matchedPhrase,
      };
      // Best-effort, don't block the chat send on this.
      storage.appendCrisisAudit(softAudit).catch(() => undefined);
    }

    const tone = profile?.tone ?? 'soft';
    const mascot = profile?.mascot ?? 'moon';
    const userMsg: ChatMessage = {
      id: String(Date.now()),
      role: 'user',
      text,
      at: new Date().toISOString(),
    };
    const replyMsg: ChatMessage = {
      id: String(Date.now() + 1),
      role: 'fernly',
      text: mockReply(text, tone, mascot),
      at: new Date().toISOString(),
    };
    const next = [...messages, userMsg, replyMsg];
    setMessages(next);
    setInput('');
    const session: ChatSession = {
      id: String(Date.now()),
      startedAt: new Date().toISOString(),
      messages: next,
    };
    await storage.addChat(session);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  const mascotEmoji =
    profile?.mascot === 'moon'
      ? '🌙'
      : profile?.mascot === 'fox'
        ? '🦊'
        : profile?.mascot === 'turtle'
          ? '🐢'
          : '🐝';

  return (
    <ScreenContainer scroll={false} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 60, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 && (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>{mascotEmoji}</Text>
              <Text style={styles.emptyTitle}>Say the first thing.</Text>
              <Text style={styles.emptySub}>
                Anything. A feeling, a worry, a "hey." I'm here and won't judge the mess.
              </Text>
              <View style={styles.quickRow}>
                <Pressable
                  style={styles.quickPill}
                  onPress={() => setInput("I'm anxious about tomorrow.")}
                >
                  <Text style={styles.quickText}>I'm anxious</Text>
                </Pressable>
                <Pressable style={styles.quickPill} onPress={() => setInput("I can't sleep.")}>
                  <Text style={styles.quickText}>I can't sleep</Text>
                </Pressable>
                <Pressable style={styles.quickPill} onPress={() => setInput('Today was hard.')}>
                  <Text style={styles.quickText}>Today was hard</Text>
                </Pressable>
              </View>
            </View>
          )}

          {messages.map((m) => (
            <View key={m.id} style={[styles.row, m.role === 'user' && styles.rowUser]}>
              <View
                style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleBot]}
              >
                <Text style={[styles.bubbleText, m.role === 'user' && { color: colors.paper }]}>
                  {m.text}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Say it however you want…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            onSubmitEditing={send}
          />
          {input.trim().length > 0 ? (
            <Pressable
              onPress={send}
              style={({ pressed }) => [styles.mic, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.micIcon}>↑</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setRecording((r) => !r)}
              style={({ pressed }) => [
                styles.mic,
                recording && styles.micRecording,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={styles.micIcon}>{recording ? '■' : '🎙'}</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <CrisisModal
        visible={crisisVisible}
        matchedPhrase={crisisMatched}
        onDismiss={() => setCrisisVisible(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  empty: { paddingHorizontal: space.s6, paddingTop: 80, alignItems: 'center' },
  emptyEmoji: { fontSize: 48, marginBottom: space.s5 },
  emptyTitle: { ...t.title, fontSize: 24, color: colors.text, marginBottom: space.s2 },
  emptySub: { ...t.body, color: colors.textSoft, textAlign: 'center', maxWidth: 280 },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: space.s5,
  },
  quickPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.full,
    backgroundColor: colors.paper2,
    borderWidth: 1,
    borderColor: colors.line,
  },
  quickText: { fontSize: 13, fontWeight: '600', color: colors.text },

  row: { paddingHorizontal: 18, marginBottom: 12, flexDirection: 'row' },
  rowUser: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', padding: 14, borderRadius: 22 },
  bubbleBot: {
    backgroundColor: colors.paper2,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
  },
  bubbleUser: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  bubbleText: { ...t.body, color: colors.text, fontSize: 15, lineHeight: 22 },

  inputBar: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
    backgroundColor: colors.paper2,
    borderRadius: radius.full,
    paddingLeft: 18,
    paddingRight: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  input: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 8, maxHeight: 120 },
  mic: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micRecording: { backgroundColor: colors.warn },
  micIcon: { color: colors.paper, fontSize: 18, fontWeight: '700' },
});
