// Player — plays one guided-meditation session from the bundled audio.
//
// Background playback + lock screen controls come from expo-audio
// (app.json plugin + setAudioModeAsync in App.tsx). Completion is recorded
// once per play-through via nextCompletionState (src/util/playback.ts).
import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, space, type as t, radius } from '../theme';
import { sessionById, type SessionDef } from '../data/sessions';
import { sessionAudio } from '../data/sessionAudio';
import { formatClock, nextCompletionState } from '../util/playback';
import { storage } from '../storage';
import type { RootStackParamList } from '../nav/RootNav';

const SKIP_BACK_SEC = 15;

export function PlayerScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Player'>>();
  const navigation = useNavigation();
  const session = sessionById(route.params.sessionId);
  const source = session ? sessionAudio[session.id] : undefined;

  if (!session || source === undefined) {
    return (
      <ScreenContainer>
        <View style={styles.missing}>
          <Text style={styles.title}>Session not available</Text>
          <Text style={styles.blurb}>
            We couldn&apos;t find that meditation. Head back and pick another one.
          </Text>
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.backBtnText}>Go back</Text>
          </Pressable>
        </View>
      </ScreenContainer>
    );
  }

  return <PlayerBody session={session} source={source} />;
}

function PlayerBody({ session, source }: { session: SessionDef; source: number }) {
  const navigation = useNavigation();
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const recordedRef = useRef(false);

  // Lock screen / media notification while this screen is mounted. The
  // hook releases the player on unmount; we also pause and clear controls.
  useEffect(() => {
    try {
      player.setActiveForLockScreen(true, { title: session.title, artist: 'Fernly' });
    } catch {
      // Best-effort: lock screen controls are not available everywhere (web).
    }
    return () => {
      try {
        player.pause();
        player.clearLockScreenControls();
      } catch {
        // Player may already be released.
      }
    };
  }, [player, session.title]);

  const duration = status.duration > 0 ? status.duration : session.durationSec;
  const position = Math.min(status.currentTime, duration);

  // Completion: decided by a pure function; the ref guards against
  // re-recording on every status tick.
  useEffect(() => {
    if (!status.isLoaded) return;
    const step = nextCompletionState(recordedRef.current, status.currentTime, status.duration);
    recordedRef.current = step.recorded;
    if (step.record) {
      storage
        .addCompletion({
          sessionId: session.id,
          completedAt: new Date().toISOString(),
          seconds: Math.round(status.duration),
        })
        .catch(() => undefined);
    }
  }, [status.isLoaded, status.currentTime, status.duration, session.id]);

  const togglePlay = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (status.duration > 0 && status.currentTime >= status.duration - 0.5) {
      // Finished: replay from the start.
      player.seekTo(0).catch(() => undefined);
    }
    player.play();
  };

  const skipBack = () => {
    player.seekTo(Math.max(0, status.currentTime - SKIP_BACK_SEC)).catch(() => undefined);
  };

  const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const remaining = Math.max(0, duration - position);

  return (
    <ScreenContainer>
      <View style={styles.wrap}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.close}
        >
          <Text style={styles.closeText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.title}>{session.title}</Text>
        <Text style={styles.blurb}>{session.blurb}</Text>

        <View style={styles.progressBlock}>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityLabel="Playback progress"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
          >
            <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
          </View>
          <View style={styles.times}>
            <Text style={styles.time}>{formatClock(position)}</Text>
            <Text style={styles.time}>-{formatClock(remaining)}</Text>
          </View>
        </View>

        <View style={styles.controls}>
          <Pressable
            onPress={skipBack}
            accessibilityRole="button"
            accessibilityLabel="Back 15 seconds"
            style={({ pressed }) => [styles.skip, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.skipText}>↺ 15</Text>
          </Pressable>
          <Pressable
            onPress={togglePlay}
            accessibilityRole="button"
            accessibilityLabel={status.playing ? 'Pause' : 'Play'}
            style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.playText}>{status.playing ? 'Pause' : 'Play'}</Text>
          </Pressable>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.s5, paddingTop: space.s4 },
  missing: { padding: space.s5, gap: space.s4 },
  close: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  closeText: { ...t.bodyBold, color: colors.accent },
  title: { ...t.displayLg, color: colors.text, marginTop: space.s4 },
  blurb: { ...t.body, color: colors.textMuted, marginTop: space.s2 },
  progressBlock: { marginTop: space.s8 },
  track: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
    overflow: 'hidden',
  },
  fill: { height: 8, backgroundColor: colors.accent },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s2 },
  time: { ...t.small, color: colors.textMuted },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s5,
    marginTop: space.s7,
  },
  skip: {
    minHeight: 56,
    minWidth: 56,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s4,
  },
  skipText: { ...t.bodyBold, color: colors.text },
  playBtn: {
    minHeight: 72,
    minWidth: 120,
    borderRadius: radius.full,
    backgroundColor: colors.lavender700,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.s6,
  },
  playText: { ...t.bodyBold, color: colors.paper2 },
  backBtn: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: radius.full,
    backgroundColor: colors.lavender700,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: space.s6,
  },
  backBtnText: { ...t.bodyBold, color: colors.paper2 },
});
