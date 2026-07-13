// Chat — the open beta stub. Real LLM in week 3 of build arc.
// For now: deterministic mock that uses the user's profile tone + mascot
// to produce varied, soft, contextual replies.
//
// v0.3 chat rewrite (closes P1 #12, #13 + P2 #19, #20, #21, #34):
//   - Virtualized rendering: FlatList (inverted) instead of ScrollView + map
//   - In-place session append: storage.appendMessageToSession
//   - Per-session SecureStore key, no full-array rewrite on send
//   - Message cap: 200 messages per session (FIFO drop)
//   - Inflight guard: isSending blocks duplicate sends
//   - AbortController declared for future LLM call
//   - TextInput maxLength: 4000 chars (prevents 10k-char pastes)
//   - Memoized message bubble to avoid re-render on every keystroke
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  ListRenderItem,
  Platform,
  Pressable,
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
import type { ChatMessage, CrisisAuditEntry, UserProfile, Tone } from '../types';

const MAX_INPUT_LENGTH = 4000;

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

// Memoized message bubble — re-renders only when its own message props change.
const MessageBubble = memo(function InnerMessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <View style={[styles.row, isUser && styles.rowUser]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot]}>
        <Text style={[styles.bubbleText, isUser && { color: colors.paper }]}>{msg.text}</Text>
      </View>
    </View>
  );
});

export function ChatScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [crisisVisible, setCrisisVisible] = useState(false);
  const [crisisMatched, setCrisisMatched] = useState<string | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // AbortController for the future LLM call. Declared now so the v0 mock
  // path can wire cancellation hooks; the mock itself is synchronous and
  // doesn't need cancellation, but the next PR that adds a real fetch
  // can reuse this.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    abortRef.current = controller;
    (async () => {
      try {
        const p = await storage.getProfile();
        if (cancelled) return;
        setProfile(p);

        // v0.3: getChats() runs the legacy-blob migration (v0 → v0.3) as
        // a side effect, then returns []. After migration, the active
        // session id either points at a migrated session, or is null and
        // we start fresh.
        await storage.getChats();

        const id = await storage.getActiveSessionId();
        if (cancelled) return;
        if (id) {
          const session = await storage.getChatSession(id);
          if (cancelled) return;
          if (session) {
            setActiveSessionId(session.id);
            setMessages(session.messages);
          } else {
            // Active id is stale — clear it.
            await storage.setActiveSessionId(null);
          }
        }
      } catch {
        // Storage layer failed. Render an empty chat so the user can
        // start fresh rather than seeing the empty state indefinitely.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  async function send() {
    if (isSending) return;
    const text = input.trim();
    if (!text) return;

    setIsSending(true);
    setInput('');

    try {
      // CRISIS CHECK FIRST. If hard, the modal wins, the LLM never sees this.
      const verdict = detectCrisis(text);

      // Ensure there's an active session — create one if not. This is the
      // single point where sessions are created, so the active-session-id
      // invariant always holds after a successful send.
      let sessionId = activeSessionId;
      if (!sessionId) {
        const session = await storage.createChatSession([]);
        sessionId = session.id;
        setActiveSessionId(session.id);
      }

      const userMsg: ChatMessage = {
        id: `${Date.now()}-u`,
        role: 'user',
        text,
        at: new Date().toISOString(),
      };

      if (verdict.level === 'hard') {
        const blocked: ChatMessage = {
          id: `${Date.now()}-f`,
          role: 'fernly',
          text: '[crisis modal shown — AI response suppressed]',
          at: new Date().toISOString(),
        };
        // Append each message individually so the chat history grows by
        // exactly two entries (one user, one suppressed reply) and the
        // session cap is enforced uniformly.
        const afterUser = await storage.appendMessageToSession(sessionId, userMsg);
        if (afterUser) setMessages(afterUser.messages);
        const afterBlocked = await storage.appendMessageToSession(sessionId, blocked);
        if (afterBlocked) setMessages(afterBlocked.messages);
        setCrisisMatched(verdict.matchedPhrase);
        setCrisisVisible(true);
        // Append a crisis audit entry. Survives clearAll(); stored in
        // encrypted SecureStore; schema-versioned.
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

      // Soft signals still go to the AI; log a flag in the audit log
      // fire-and-forget so the chat send isn't blocked.
      if (verdict.level === 'soft' && verdict.matchedPhrase) {
        const softAudit: CrisisAuditEntry = {
          version: 1,
          id: `${Date.now()}-audit`,
          at: new Date().toISOString(),
          severity: 'soft',
          matchedPhrase: verdict.matchedPhrase,
        };
        storage.appendCrisisAudit(softAudit).catch(() => undefined);
      }

      // v0 mock path — synchronous, no LLM fetch yet. Future PRs swap
      // mockReply() for a fetch() and route through the abortRef.
      const tone = profile?.tone ?? 'soft';
      const mascot = profile?.mascot ?? 'moon';
      const replyMsg: ChatMessage = {
        id: `${Date.now()}-f`,
        role: 'fernly',
        text: mockReply(text, tone, mascot),
        at: new Date().toISOString(),
      };
      const afterUser = await storage.appendMessageToSession(sessionId, userMsg);
      if (afterUser) setMessages(afterUser.messages);
      const afterReply = await storage.appendMessageToSession(sessionId, replyMsg);
      if (afterReply) setMessages(afterReply.messages);
    } finally {
      setIsSending(false);
    }
  }

  const mascotEmoji = useMemo(
    () =>
      profile?.mascot === 'moon'
        ? '🌙'
        : profile?.mascot === 'fox'
          ? '🦊'
          : profile?.mascot === 'turtle'
            ? '🐢'
            : '🐝',
    [profile?.mascot],
  );

  const renderItem: ListRenderItem<ChatMessage> = useCallback(
    ({ item }) => <MessageBubble msg={item} />,
    [],
  );

  const keyExtractor = useCallback((m: ChatMessage) => m.id, []);

  // Empty state — shown when no messages and no session is active.
  const ListEmptyComponent = useMemo(
    () => (
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
    ),
    [mascotEmoji],
  );

  return (
    <ScreenContainer scroll={false} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          inverted
          // Padding-top is the original 60 (above the first message); padding-bottom
          // is 100 to clear the input bar.
          contentContainerStyle={messages.length > 0 ? styles.listContent : undefined}
          ListEmptyComponent={loaded ? ListEmptyComponent : null}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          windowSize={11}
          maxToRenderPerBatch={10}
          removeClippedSubviews
        />

        <View style={styles.inputBar}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Say it however you want…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            maxLength={MAX_INPUT_LENGTH}
            editable={!isSending}
            onSubmitEditing={send}
            blurOnSubmit={false}
          />
          {input.trim().length > 0 ? (
            <Pressable
              onPress={send}
              disabled={isSending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={({ pressed }) => [
                styles.mic,
                isSending && styles.micDisabled,
                pressed && !isSending && { opacity: 0.8 },
              ]}
            >
              <Text style={styles.micIcon}>↑</Text>
            </Pressable>
          ) : (
            // v0.4: mic button replaced with a "voice coming soon" stub.
            // The previous code toggled a `recording` state and turned the
            // button red, but no audio was captured (no expo-av, no
            // permission flow). That silently lied about a feature that
            // doesn't exist — worse in a moment of distress when the user
            // might rely on voice instead of typing. Until voice ships,
            // show a non-interactive label so the user knows it's coming.
            <View style={[styles.mic, styles.micSoon]} accessibilityLabel="Voice coming soon">
              <Text style={styles.micSoonText}>🎙 soon</Text>
            </View>
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
  flex: { flex: 1 },
  empty: { paddingHorizontal: space.s6, paddingTop: 80, alignItems: 'center' },
  emptyEmoji: { fontSize: 48, marginBottom: space.s5 },
  emptyTitle: { ...t.title, fontSize: 24, color: colors.text, marginBottom: space.s2 },
  emptySub: {
    ...t.body,
    color: colors.textSoft,
    textAlign: 'center',
    maxWidth: 280,
  },
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

  listContent: { paddingTop: 60, paddingBottom: 100 },
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
    width: 56,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micDisabled: { backgroundColor: colors.ink4 },
  micSoon: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line, width: 64 },
  micSoonText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  micIcon: { color: colors.paper, fontSize: 18, fontWeight: '700' },
});
