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
import { newId } from '../util/id';
import { MASCOT_EMOJI, MASCOT_EMOJI_FALLBACK } from '../data/mascots';
import type { ChatMessage, ChatSession, CrisisAuditEntry, UserProfile, Tone } from '../types';
import { fetchReply, readChatBackendUrl } from '../api/chat';

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
  // v0.9: FlatList ref so we can scroll to end on initial mount and
  // when a new message lands. Replaces the `inverted` prop removed in
  // this commit (plans/05 P1-12).
  const chatListRef = useRef<FlatList<ChatMessage>>(null);
  // v0.9: track whether the user has scrolled up so we don't
  // auto-scroll when they're reading older messages. Without this,
  // every new user message would yank the screen to the bottom
  // even if the user had intentionally scrolled up to read history.
  const [stickToBottom, setStickToBottom] = useState(true);

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
    // Set once the user's message is saved. After that, a failure must not
    // put the text back for a retry, or the retry would save it twice.
    let userSaved = false;

    try {
      // CRISIS CHECK FIRST. If hard, the modal wins, the LLM never sees this.
      const verdict = detectCrisis(text);

      // Show the crisis modal BEFORE any await, so a storage failure below
      // can never hide it.
      if (verdict.level === 'hard') {
        setCrisisMatched(verdict.matchedPhrase);
        setCrisisVisible(true);
      }

      // Ensure there's an active session — create one if not. Single-flight
      // guard so concurrent sends share the same createChatSession
      // promise instead of racing each other (which used to create two
      // sessions and double-append messages).
      let sessionId = activeSessionId;
      if (!sessionId) {
        if (!sessionCreateRef.current) {
          // Clear the shared promise however it settles. If a rejected one
          // stayed cached, every later send would await it and fail.
          sessionCreateRef.current = storage.createChatSession([]).finally(() => {
            sessionCreateRef.current = null;
          });
        }
        const session = await sessionCreateRef.current;
        sessionId = session.id;
        setActiveSessionId(session.id);
      }

      const userMsg: ChatMessage = {
        id: newId(),
        role: 'user',
        text,
        at: new Date().toISOString(),
      };

      if (verdict.level === 'hard') {
        const blocked: ChatMessage = {
          id: newId(),
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
        // Append a crisis audit entry. Survives clearAll(); stored in
        // encrypted SecureStore; schema-versioned.
        const audit: CrisisAuditEntry = {
          version: 1,
          id: newId(),
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
          id: newId(),
          at: new Date().toISOString(),
          severity: 'soft',
          matchedPhrase: verdict.matchedPhrase,
        };
        storage.appendCrisisAudit(softAudit).catch(() => undefined);
      }

      // v0.9 (F-P0-3): real backend when EXPO_PUBLIC_CHAT_API_URL is set;
      // mockReply() otherwise. The backend wiring is in src/api/chat.ts
      // and follows the standard { reply: string } shape. Without the
      // env var, this branch falls back to the deterministic mock so
      // v0 keeps working offline. Plans/05 P0-3.
      const tone = profile?.tone ?? 'soft';
      const backendUrl = readChatBackendUrl();
      let replyText: string;
      if (backendUrl) {
        const abort = new AbortController();
        // The chat-screen's unmount effect can't see this controller;
        // we rely on the send() promise resolution + the request's own
        // 12s timeout. Future work: wire to isCancelledRef.
        const result = await fetchReply(
          { input: text, tone, sessionId },
          { url: backendUrl },
          abort.signal,
        );
        replyText = result.reply;
      } else {
        replyText = mockReply(text, tone);
      }
      const replyMsg: ChatMessage = {
        id: newId(),
        role: 'fernly',
        text: replyText,
        at: new Date().toISOString(),
      };
      const afterUser = await storage.appendMessageToSession(sessionId, userMsg);
      userSaved = true;
      if (afterUser) setMessages(afterUser.messages);
      const afterReply = await storage.appendMessageToSession(sessionId, replyMsg);
      if (afterReply) setMessages(afterReply.messages);
    } catch (err) {
      // v0.9: restore the draft so the user can retry, and surface
      // the failure via Alert instead of silently swallowing. The
      // previous behavior cleared `input` upfront on line 154 and
      // let any error propagate uncaught. See plans/05 P1-11.
      console.warn('[ChatScreen] send failed:', err);
      // The crisis modal is already up; don't stack an error alert on top
      // of it or put the crisis text back in the input.
      if (detectCrisis(text).level === 'hard') return;
      if (userSaved) {
        Alert.alert(
          "Couldn't save Fernly's reply",
          'Your message was saved. Send another message to keep going, and if it keeps failing, restart the app.',
        );
        return;
      }
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

  // v0.9: scroll-to-end on mount and on every new message IF the
  // user is still glued to the bottom. If they've scrolled up to read
  // history, we don't yank them back. Plans/05 P1-12.
  useEffect(() => {
    if (!loaded) return;
    if (messages.length === 0) return;
    if (!stickToBottom) return;
    // requestAnimationFrame ensures the list has rendered before we
    // measure scrollToEnd. Without it, scrollToEnd occasionally
    // fires before the new row has been laid out, leaving the user
    // one row from the bottom.
    const id = requestAnimationFrame(() => {
      chatListRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [messages, loaded, stickToBottom]);

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
          // v0.9: dropped the inverted prop. Plans/05 P1-12 caught
          // that the chat data is appended oldest-first (storage.ts
          // appendMessageToSession shape) but `inverted` is meant
          // for newest-first data. The combination rendered the
          // conversation in reverse order on restore. Removing
          // inverted + scrolling to end on message change matches the
          // obvious-read direction without an array reversal
          // (memory-cheaper for long sessions).
          ref={chatListRef}
          onScroll={(e) => {
            // Track whether the user is at the bottom. Used by the
            // auto-scroll-to-end useEffect so a user reading history
            // doesn't get yanked. A 36pt slack handles iOS bounce
            // overshoot and 3pt tab/touch surfaces cleanly.
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const distanceFromBottom =
              contentSize.height - contentOffset.y - layoutMeasurement.height;
            setStickToBottom(distanceFromBottom < 36);
          }}
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
        {/* v0.9: "Jump to newest" pill — only shown when the user
            has scrolled up (stickToBottom === false). Tapping it
            re-enables auto-scroll and scrolls to end. Same pattern
            as iMessage / Signal. */}
        {!stickToBottom && messages.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to newest message"
            onPress={() => {
              chatListRef.current?.scrollToEnd({ animated: true });
              setStickToBottom(true);
            }}
            style={styles.jumpToNewest}
          >
            <Text style={styles.jumpToNewestText}>↓ Newer</Text>
          </Pressable>
        )}

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
  jumpToNewest: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 12px rgba(42, 36, 56, 0.18)',
  },
  jumpToNewestText: { ...t.smallBold, color: colors.paper, fontSize: 13 },
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
