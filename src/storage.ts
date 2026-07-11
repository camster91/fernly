// AsyncStorage wrapper — typed, namespaced, JSON-safe
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserProfile, MoodEntry, ChatSession } from './types';

const KEYS = {
  profile:    '@fernly/profile',
  moods:      '@fernly/moods',
  sessions:   '@fernly/sessions',
  chats:      '@fernly/chats',
  onboarding: '@fernly/onboarding-complete',
} as const;

export const storage = {
  async getProfile(): Promise<UserProfile | null> {
    const raw = await AsyncStorage.getItem(KEYS.profile);
    return raw ? JSON.parse(raw) : null;
  },
  async setProfile(p: UserProfile) {
    await AsyncStorage.setItem(KEYS.profile, JSON.stringify(p));
  },
  async getMoods(): Promise<MoodEntry[]> {
    const raw = await AsyncStorage.getItem(KEYS.moods);
    return raw ? JSON.parse(raw) : [];
  },
  async addMood(m: MoodEntry) {
    const all = await storage.getMoods();
    const filtered = all.filter(x => x.date !== m.date);
    await AsyncStorage.setItem(KEYS.moods, JSON.stringify([m, ...filtered]));
  },
  async getChats(): Promise<ChatSession[]> {
    const raw = await AsyncStorage.getItem(KEYS.chats);
    return raw ? JSON.parse(raw) : [];
  },
  async addChat(s: ChatSession) {
    const all = await storage.getChats();
    await AsyncStorage.setItem(KEYS.chats, JSON.stringify([s, ...all]));
  },
  async getOnboarded(): Promise<boolean> {
    return (await AsyncStorage.getItem(KEYS.onboarding)) === 'true';
  },
  async setOnboarded(v: boolean) {
    await AsyncStorage.setItem(KEYS.onboarding, v ? 'true' : 'false');
  },
  async clearAll() {
    await AsyncStorage.multiRemove(Object.values(KEYS));
  },
};