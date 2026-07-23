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
//   - TextInput maxLength: 4000 chars (prevents 10k-char pastes)
//   - Memoized message bubble to avoid re-render on every keystroke
// v0.7: removed abortRef + useRef (no fetch yet). When the LLM ships,
// AbortController + useRef re-enter.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import { MASCOT_EMOJI, MASCOT_EMOJI_FALLBACK } from '../data/mascots';
import type { ChatMessage, ChatSession, CrisisAuditEntry, UserProfile, Tone } from '../types';

const MAX_INPUT_LENGTH = 4000;

// Deterministic mock responder — picks a reply based on user input + their tone.
// NOT an LLM. Replace with real chat backend in build week 3.
function mockReply(input: string, tone: Tone): string {
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
  // v0.8: useRef for the in-flight guard. useState lags one render
  // commit, so a rapid double-tap (keyboard Enter + send-button
  // press before React re-renders) sees isSending === false on
  // both invocations and runs send() twice — duplicate messages,
  // duplicate session creations. See plans/05-full-codebase-review-
  // 2026-07-22.md P0-4.
  const isSendingRef = useRef(false);
  // Single-flight guard for createChatSession — the !sessionId branch
  // is async and can race against itself on rapid taps. The first
  // invocation populates this ref; concurrent invocations await the
  // same promise.
  const sessionCreateRef = useRef<Promise<ChatSession> | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
          // v0.8: check cancelled AFTER every async hop. The previous
          // code only checked once after the await, so a navigaway-
          // mid-resolve still triggered the stale-id write at line 112.
          // See plans/05-full-codebase-review-2026-07-22.md P0-5.
          if (cancelled) return;
          if (session) {
            setActiveSessionId(session.id);
            setMessages(session.messages);
          } else if (!cancelled) {
            // Active id is stale — clear it. Guarded by cancelled
            // so an unmount doesn't clobber persisted state.
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
    };
  }, []);

  async function send() {
    // v0.8: useRef-backed guard (lines 86-88) instead of useState isSending.
    // useState lags one render commit — rapid double-tap (keyboard Enter
    // + send-button press) sees isSending === false on both invocations.
    // The ref flips synchronously inside the same tick.
    if (isSendingRef.current) return;
    const text = input.trim();
    if (!text) return;
    isSendingRef.current = true;
    setIsSending(true); // also drives the UI disabled state
    // v0.9: keep the original text as a draft. If any persistence
    // step throws, restore the draft so the user can retry instead
    // of seeing their message vanish. For a wellness app where the
    // content may be emotionally important, silent text loss is the
    // worst possible failure mode. See plans/05 P1-11.
    const draft = input;
    setInput('');

    try {
      // CRISIS CHECK FIRST. If hard, the modal wins, the LLM never sees this.
      const verdict = detectCrisis(text);

      // Ensure there's an active session — create one if not. Single-flight
      // guard so concurrent sends share the same createChatSession
      // promise instead of racing each other (which used to create two
      // sessions and double-append messages).
      let sessionId = activeSessionId;
      if (!sessionId) {
        if (!sessionCreateRef.current) {
          sessionCreateRef.current = storage.createChatSession([]);
        }
        const session = await sessionCreateRef.current;
        sessionCreateRef.current = null;
        sessionId = session.id;
        setActiveSessionId(session.id);
      }

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text,
        at: new Date().toISOString(),
      };

      if (verdict.level === 'hard') {
        const blocked: ChatMessage = {
          id: crypto.randomUUID(),
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
          id: crypto.randomUUID(),
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
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          severity: 'soft',
          matchedPhrase: verdict.matchedPhrase,
        };
        storage.appendCrisisAudit(softAudit).catch(() => undefined);
      }

      // v0 mock path — synchronous, no LLM fetch yet. When the LLM
      // ships, this is where the AbortController + fetch() wire in.
      const tone = profile?.tone ?? 'soft';
      const replyMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'fernly',
        text: mockReply(text, tone),
        at: new Date().toISOString(),
      };
      const afterUser = await storage.appendMessageToSession(sessionId, userMsg);
      if (afterUser) setMessages(afterUser.messages);
      const afterReply = await storage.appendMessageToSession(sessionId, replyMsg);
      if (afterReply) setMessages(afterReply.messages);
    } catch (err) {
      // v0.9: restore the draft so the user can retry, and surface
      // the failure via Alert instead of silently swallowing. The
      // previous behavior cleared `input` upfront on line 154 and
      // let any error propagate uncaught. See plans/05 P1-11.
      console.warn('[ChatScreen] send failed:', err);
      setInput(draft);
      // Alert.alert is safe to use here — RN's Alert always renders on
      // both platforms; even if a render error boundary catches the
      // throw above, the input draft restoration guarantees no data
      // loss before the user sees the failure.
      Alert.alert(
        'Could not send your message',
        'Your text is still in the input — try again, and if it keeps failing, restart the app.',
      );
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  }

  // Use the shared MASCOT_EMOJI map. Empty-state fallback is 🌙 (the
  // onboarding default mascot) — not 🐝 as before — so the empty chat
  // matches what the user picked during onboarding.
  const mascotEmoji = useMemo(
    () => (profile?.mascot && MASCOT_EMOJI[profile.mascot]) || MASCOT_EMOJI_FALLBACK,
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
            accessibilityRole="button"
            accessibilityLabel="I'm anxious — fill the input"
            accessibilityHint="Starts the chat with 'I'm anxious about tomorrow.'"
          >
            <Text style={styles.quickText}>I'm anxious</Text>
          </Pressable>
          <Pressable
            style={styles.quickPill}
            onPress={() => setInput("I can't sleep.")}
            accessibilityRole="button"
            accessibilityLabel="I can't sleep — fill the input"
            accessibilityHint="Starts the chat with 'I can't sleep.'"
          >
            <Text style={styles.quickText}>I can't sleep</Text>
          </Pressable>
          <Pressable
            style={styles.quickPill}
            onPress={() => setInput('Today was hard.')}
            accessibilityRole="button"
            accessibilityLabel="Today was hard — fill the input"
            accessibilityHint="Starts the chat with 'Today was hard.'"
          >
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
    // v0.9: vertical padding + 13pt line height totaled ~36pt —
    // below the WCAG AA-target 44pt touch-surface minimum. Bumped to
    // match the MoodCheckInScreen feel. Plans/05 P2-17.
    paddingVertical: 12,
    minHeight: 44,
    borderRadius: radius.full,
    backgroundColor: colors.paper2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
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
  // WCAG 2.5.5 AAA: 44×44 minimum tap target. Was 56×38 (height < 44);
  // hand tremor or imprecise taps in distress failed to register.
  mic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micDisabled: { backgroundColor: colors.ink4 },
  // Voice-coming-soon placeholder kept 64-wide to fit "Coming soon"
  // text, but explicit minHeight 44 + a11y role/label so it isn't
  // mistaken for an active button.
  micSoon: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.line,
    minHeight: 44,
    paddingHorizontal: 8,
  },
  micSoonText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  micIcon: { color: colors.paper, fontSize: 18, fontWeight: '700' },
});
