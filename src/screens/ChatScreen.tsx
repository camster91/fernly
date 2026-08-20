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
  Modal,
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
import { MASCOT_EMOJI, MASCOT_EMOJI_FALLBACK } from '../data/mascots';
import type { ChatMessage, ChatSession, CrisisAuditEntry, UserProfile, Tone } from '../types';
import {
  fetchReply,
  readChatBackendUrl,
  readHostAllowlist,
} from '../api/chat';
import { resolveRealChatDecision } from '../api/chat-feature-flag';
import {
  ChatUsageLimitError,
  getChatUsageSnapshot,
  reserveSlot,
} from '../api/chat-usage';

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

/**
 * v0.11 (issue #41): resolve the chat reply for a given send. Three
 * possible paths:
 *   1. Mock (decision.enabled === false): env flag off, no URL, or
 *      override disabled.
 *   2. Real → mock fallback: decision.enabled is true, but the
 *      URL read failed OR the usage counter is exhausted. The user
 *      still gets a reply (a deterministic one).
 *   3. Real: full fetch with auth, HTTPS, host allowlist, and
 *      schema validation. Any failure falls back to mock — the
 *      `auth-missing` case is a fetchReply-throw today because #46
 *      isn't wired, which is the intended "client holds no creds"
 *      guarantee.
 *
 * The function returns a string and never throws. Internal errors
 * (network, usage, auth) are caught and logged; the call site
 * (send()) already restores the user draft on any outer throw so
 * this function's fail-soft path is the only fallback the user
 * experiences for "real" send failures.
 */
async function resolveReplyText(args: {
  input: string;
  tone: Tone;
  sessionId: string;
  decision: { enabled: boolean; reason: string };
}): Promise<string> {
  const { input, tone, sessionId, decision } = args;
  if (!decision.enabled) {
    console.log(`[ChatScreen] mock path (reason: ${decision.reason})`);
    return mockReply(input, tone);
  }
  // Real path. Reserve a usage slot first — if the user is over
  // their burst or daily cap, we fall back to mock rather than
  // failing the send. The user still gets a reply and the cost
  // cap holds.
  try {
    await reserveSlot();
  } catch (e) {
    if (e instanceof ChatUsageLimitError) {
      console.warn(
        `[ChatScreen] usage limit hit (${e.limit} ${e.used}/${e.cap}); falling back to mock`,
      );
      return mockReply(input, tone);
    }
    throw e;
  }
  // Read URL again — the env could have changed between the
  // decision and now (theoretically). If the URL read throws
  // (non-https config), we degrade to mock rather than crashing.
  let backendUrl: string | null = null;
  try {
    backendUrl = readChatBackendUrl();
  } catch (e) {
    console.warn('[ChatScreen] readChatBackendUrl threw, using mock:', e);
    return mockReply(input, tone);
  }
  if (!backendUrl) return mockReply(input, tone);
  const abort = new AbortController();
  // v0.11 (issue #41): the backend now requires an authenticated
  // identity. The auth layer (#46) will provide a real
  // getAuthToken; for v0 we expose a stub that returns null —
  // which makes fetchReply throw ChatBackendError(auth-missing)
  // and we fall back to mock. This is the "client contains no
  // provider credentials" guarantee: there is no path where the
  // client holds a key.
  try {
    const result = await fetchReply(
      { input, tone, sessionId },
      {
        url: backendUrl,
        hostAllowlist: readHostAllowlist(),
        getAuthToken: async () => {
          // TODO(#46): wire to the real auth provider.
          return null;
        },
      },
      abort.signal,
    );
    return result.reply;
  } catch (e) {
    // The fetch site already wraps fetchReply in a try/catch in
    // send() — but a throw here would surface as a generic Alert.
    // Better UX: log the specific ChatBackendError kind and fall
    // back to mock so the user still gets a reply.
    if (e && typeof e === 'object' && 'kind' in e) {
      const k = (e as { kind?: string }).kind;
      console.warn(`[ChatScreen] fetchReply threw kind=${k}; falling back to mock`);
    } else {
      console.warn('[ChatScreen] fetchReply threw; falling back to mock:', e);
    }
    return mockReply(input, tone);
  }
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

  // v0.10 (issue #79): a focused read failure on chat is distinct
  // from "no prior conversation". A returning user with a history
  // who sees an empty chat because the read failed has been
  // silently reset. The screen tracks a focused hydration error so
  // the user can see what happened and retry.
  const [chatLoadError, setChatLoadError] = useState<string | null>(null);
  // v0.10 (issue #70): history sheet open state. Set true when
  // the user taps "History"; reset on close. `historyTick` is a
  // reload counter that bumps on every send/delete so the sheet
  // re-enumerates the session list next time it opens.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // v0.10 (issue #79): use the result-returning safe read so a
      // profile-storage failure is shown to the user instead of
      // being collapsed into an empty profile + empty chat. The
      // getChats() legacy migration still runs (it has its own
      // defensive two-phase write) but its failure is also surfaced.
      const profileResult = await storage.getProfileSafe();
      if (cancelled) return;
      if (profileResult.kind === 'error') {
        setChatLoadError(profileResult.reason);
        setLoaded(true);
        return;
      }
      setProfile(profileResult.kind === 'ready' ? profileResult.profile : null);
      setChatLoadError(null);

      // v0.3: getChats() runs the legacy-blob migration (v0 → v0.3) as
      // a side effect, then returns []. After migration, the active
      // session id either points at a migrated session, or is null and
      // we start fresh.
      try {
        await storage.getChats();
      } catch (e) {
        if (cancelled) return;
        // Legacy migration is best-effort; if it throws, the user
        // can still chat — they'll just start a new session.
        setChatLoadError(
          e instanceof Error
            ? `Couldn't migrate legacy chats: ${e.message}`
            : "Couldn't migrate legacy chats.",
        );
      }

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
      if (!cancelled) setLoaded(true);
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
        // v0.10 (issue #70): new session just created — bump the
        // history reload tick so it appears in the list next open.
        setHistoryTick((t) => t + 1);
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
        // v0.10 (issue #70): bump the history reload tick so the
        // history sheet sees the updated message count next open.
        setHistoryTick((t) => t + 1);
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

      // v0.9 (F-P0-3): real backend when EXPO_PUBLIC_CHAT_API_URL is set;
      // mockReply() otherwise. The backend wiring is in src/api/chat.ts
      // and follows the standard { reply: string } shape. Without the
      // env var, this branch falls back to the deterministic mock so
      // v0 keeps working offline. Plans/05 P0-3.
      //
      // v0.11 (issue #41): the "real chat" gate is now the feature
      // flag, NOT just the URL presence. Three independent layers must
      // agree before the wire is touched:
      //   1. env EXPO_PUBLIC_CHAT_API_URL is set (a backend exists)
      //   2. env EXPO_PUBLIC_CHAT_BACKEND_ENABLED is truthy (the
      //      operator has approved this build for the real backend)
      //   3. the in-app override is not explicitly false (the
      //      user/device hasn't opted out)
      // Plus #4: the per-day / per-minute usage counter has room.
      const tone = profile?.tone ?? 'soft';
      const decision = await resolveRealChatDecision();
      const replyText = await resolveReplyText({
        input: text,
        tone,
        sessionId,
        decision,
      });
      const replyMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'fernly',
        text: replyText,
        at: new Date().toISOString(),
      };
      const afterUser = await storage.appendMessageToSession(sessionId, userMsg);
      if (afterUser) setMessages(afterUser.messages);
      const afterReply = await storage.appendMessageToSession(sessionId, replyMsg);
      if (afterReply) setMessages(afterReply.messages);
      // v0.10 (issue #70): bump the history reload tick so the
      // history sheet sees the updated message count next open.
      setHistoryTick((t) => t + 1);
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

  // v0.10 (issue #70): start a fresh conversation. The active
  // session id is cleared so the next send creates a new
  // ChatSession. Any unsent draft text in the input is preserved
  // (the user might want to re-send the same message into a
  // different conversation).
  async function startNewConversation() {
    if (isSendingRef.current) return;
    setActiveSessionId(null);
    setMessages([]);
    setCrisisVisible(false);
    setCrisisMatched(undefined);
  }

  return (
    <ScreenContainer scroll={false} edges={['top']}>
      {/* v0.10 (issue #79): visible signal that a focused read failed.
          Sits at the top of the chat surface so the user sees it
          before any empty-state copy. Non-blocking — they can still
          type — but visible enough that the data interpretation is
          "couldn't read" not "no data". */}
      {chatLoadError && (
        <View
          style={styles.loadErrorChip}
          accessible={true}
          accessibilityRole="alert"
          accessibilityLabel={`Couldn't read your chat: ${chatLoadError}. Close and reopen the app to retry.`}
        >
          <Text style={styles.loadErrorText}>
            ⚠️ Couldn't read your chat. Close and reopen the app to retry.
          </Text>
        </View>
      )}

      {/* v0.10 (issue #70): visible chat controls. The "New"
          button creates a fresh conversation; the "History"
          button opens the history sheet for switching /
          deleting prior sessions. Both sit above the message
          list so the user can find them before typing. */}
      <View style={styles.chatControls}>
        <Pressable
          onPress={startNewConversation}
          accessibilityRole="button"
          accessibilityLabel="Start a new conversation"
          accessibilityHint="Saves the current session and starts fresh"
          style={({ pressed }) => [styles.chatCtrlBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.chatCtrlBtnText}>+ New</Text>
        </Pressable>
        <Pressable
          onPress={() => setHistoryOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open chat history"
          accessibilityHint="Browse, switch, or delete past conversations"
          style={({ pressed }) => [styles.chatCtrlBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.chatCtrlBtnText}>History</Text>
        </Pressable>
      </View>

      {/* v0.10 (issue #70): history sheet — see ChatHistorySheet
          for the data model. Mounted at the end of the screen so
          it can float over the message list when open. */}
      <ChatHistorySheet
        visible={historyOpen}
        activeSessionId={activeSessionId}
        onClose={() => setHistoryOpen(false)}
        onSwitch={async (id) => {
          setHistoryOpen(false);
          if (id === activeSessionId) return;
          // Persist the new active id and load the messages.
          await storage.setActiveSessionId(id);
          const session = await storage.getChatSession(id);
          if (session) {
            setActiveSessionId(session.id);
            setMessages(session.messages);
          }
          // v0.10 (issue #70): switched active session — no
          // reload tick bump needed since the session list itself
          // is unchanged (only the active highlight moves).
        }}
        onDelete={async (id) => {
          const ok = await storage.deleteChatSession(id);
          if (ok && id === activeSessionId) {
            // The deleted session was the active one — clear
            // local state so the user starts fresh.
            setActiveSessionId(null);
            setMessages([]);
          }
          // Force the history sheet to re-enumerate next open.
          setHistoryTick((t) => t + 1);
          return ok;
        }}
        // Re-enumerate on any open so newly-sent messages appear.
        reloadTick={historyTick}
      />
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

// v0.10 (issue #70): history sheet — modal showing every chat
// session with date, message count, and active highlight. Tapping
// a row switches the active session; long-press (or a dedicated
// Delete button) deletes it with confirmation. Previews do NOT
// show message text — only the start date and a count — to
// prevent the user's exact phrasing from being exposed when the
// list is visible to a screen reader or shoulder-surfer.
function ChatHistorySheet({
  visible,
  activeSessionId,
  onClose,
  onSwitch,
  onDelete,
  reloadTick,
}: {
  visible: boolean;
  activeSessionId: string | null;
  onClose: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
  reloadTick: number;
}) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { sessions: all, unreadable } = await storage.getAllChatSessions();
      if (cancelled) return;
      setSessions(all);
      setLoading(false);
      if (unreadable.length > 0) {
        setError(`${unreadable.length} session(s) couldn't be read.`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // reloadTick is a no-op dep that the parent bumps after a
    // delete or send so the sheet re-enumerates the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reloadTick]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <View style={historyStyles.backdrop}>
        <View style={historyStyles.sheet}>
          <View style={historyStyles.headerRow}>
            <Text style={historyStyles.title} accessibilityRole="header">
              Chat history
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close history"
              style={({ pressed }) => [historyStyles.closeBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={historyStyles.closeBtnText}>Close</Text>
            </Pressable>
          </View>

          {loading && (
            <View style={historyStyles.center}>
              <Text style={historyStyles.centerText}>Loading…</Text>
            </View>
          )}
          {error && !loading && (
            <View
              style={historyStyles.errorBanner}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <Text style={historyStyles.errorText}>{error}</Text>
            </View>
          )}
          {!loading && sessions.length === 0 && (
            <View style={historyStyles.center}>
              <Text style={historyStyles.emptyEmoji}>💬</Text>
              <Text style={historyStyles.emptyTitle}>No conversations yet.</Text>
              <Text style={historyStyles.emptySub}>
                Start a chat and it'll show up here. New conversations don't delete older ones.
              </Text>
            </View>
          )}

          {!loading && sessions.length > 0 && (
            <ScrollView style={historyStyles.list}>
              {sessions.map((s) => {
                const isActive = s.id === activeSessionId;
                const startDate = new Date(s.startedAt);
                const dateLabel = isToday(startDate)
                  ? `Today, ${formatTime(startDate)}`
                  : isYesterday(startDate)
                    ? `Yesterday, ${formatTime(startDate)}`
                    : `${formatDate(startDate)}, ${formatTime(startDate)}`;
                return (
                  <View
                    key={s.id}
                    style={[historyStyles.row, isActive && historyStyles.rowActive]}
                  >
                    <Pressable
                      onPress={() => onSwitch(s.id)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isActive
                          ? `Current conversation, ${s.messages.length} messages, started ${dateLabel}`
                          : `Switch to conversation from ${dateLabel}, ${s.messages.length} messages`
                      }
                      accessibilityState={{ selected: isActive }}
                      style={({ pressed }) => [
                        historyStyles.rowMain,
                        pressed && { opacity: 0.85 },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={historyStyles.rowDate}>{dateLabel}</Text>
                        <Text style={historyStyles.rowMeta}>
                          {s.messages.length} message
                          {s.messages.length === 1 ? '' : 's'}
                          {isActive ? ' · current' : ''}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        Alert.alert(
                          'Delete this conversation?',
                          'This permanently removes the chat from this device. Cannot be undone.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: async () => {
                                const ok = await onDelete(s.id);
                                if (!ok) {
                                  Alert.alert(
                                    "Couldn't delete",
                                    'Please try again, or close and reopen the app.',
                                  );
                                }
                              },
                            },
                          ],
                        );
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete conversation from ${dateLabel}`}
                      style={({ pressed }) => [
                        historyStyles.deleteBtn,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={historyStyles.deleteBtnText}>Delete</Text>
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
function isYesterday(d: Date): boolean {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return (
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate()
  );
}
function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // v0.10 (issue #79): chat load-error chip. Sits above the
  // KeyboardAvoidingView so it always renders even when the
  // keyboard is up. Same color/tone as the TodayScreen chip.
  loadErrorChip: {
    backgroundColor: colors.yellow100,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginHorizontal: space.s6,
    marginTop: space.s2,
    borderRadius: radius.md,
  },
  loadErrorText: { ...t.small, color: colors.text, textAlign: 'center' },

  // v0.10 (issue #70): chat control row sits above the message
  // list. Two compact buttons — New + History — so the user has
  // conversation controls without leaving the chat surface.
  chatControls: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: space.s6,
    paddingVertical: space.s2,
  },
  chatCtrlBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.lavender300,
    backgroundColor: colors.paper2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatCtrlBtnText: { ...t.bodyBold, color: colors.lavender700, fontSize: 13 },
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
    // v0.10 (issue #62): minHeight 44pt (WCAG 2.5.5) — was 36pt
    // which fell below the recommended tap target. The
    // shadow + label adds visual weight; the larger touch
    // area is easier to hit one-handed on the chat surface.
    minHeight: 44,
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

// v0.10 (issue #70): history sheet styles. Separate stylesheet
// to keep the chat-screen styles readable.
const historyStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.s6,
    paddingTop: space.s5,
    paddingBottom: space.s7,
    maxHeight: '85%',
    minHeight: 320,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.s4,
  },
  title: { ...t.title, fontSize: 22, color: colors.text },
  closeBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
  },
  closeBtnText: { ...t.bodyBold, color: colors.lavender700, fontSize: 14 },
  center: { alignItems: 'center', paddingVertical: space.s7 },
  centerText: { ...t.body, color: colors.textMuted },
  emptyEmoji: { fontSize: 48, marginBottom: space.s3 },
  emptyTitle: { ...t.title, fontSize: 18, color: colors.text, marginBottom: 4 },
  emptySub: {
    ...t.small,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 280,
  },
  errorBanner: {
    backgroundColor: colors.yellow100,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: space.s3,
  },
  errorText: { ...t.small, color: colors.text, textAlign: 'center' },
  list: { maxHeight: 480 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: space.s2,
    overflow: 'hidden',
  },
  rowActive: { borderColor: colors.accentSelected, borderWidth: 2 },
  rowMain: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 56,
    justifyContent: 'center',
  },
  rowDate: { ...t.bodyBold, color: colors.text, fontSize: 14, marginBottom: 2 },
  rowMeta: { ...t.small, color: colors.textMuted, fontSize: 12 },
  deleteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: colors.line,
  },
  deleteBtnText: { ...t.bodyBold, color: colors.warn, fontSize: 13 },
});
