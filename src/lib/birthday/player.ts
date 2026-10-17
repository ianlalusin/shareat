'use client';

import { registerPlugin, Capacitor } from '@capacitor/core';

/** Native side: android/.../BirthdaySongPlugin.java (audio focus only). */
interface BirthdaySongPlugin {
  requestAudioFocus(): Promise<{ granted: boolean }>;
  abandonAudioFocus(): Promise<void>;
}

const Native = registerPlugin<BirthdaySongPlugin>('BirthdaySong');

/** Played in this order, then looped until stopped. Files live in public/sounds. */
export const PLAYLIST = ['/sounds/birthday-shareat.mp3', '/sounds/happy-birthday.mp3'] as const;

/** Index of the track after `i`, wrapping back to the first. */
export function nextTrack(i: number, length: number = PLAYLIST.length): number {
  return (i + 1) % length;
}

/** A track counts as heard once this much of it has played. */
export const HEARD_FRACTION = 0.75;

/**
 * Where the next Play starts: the track after the one last stopped if at least 75% of
 * it played, otherwise that same track again. With no history, the first track.
 */
export function pickStartTrack(
  last: { track: number; fraction: number } | null,
  length: number = PLAYLIST.length,
): number {
  if (!last || !Number.isInteger(last.track) || last.track < 0 || last.track >= length) return 0;
  return last.fraction >= HEARD_FRACTION ? nextTrack(last.track, length) : last.track;
}

// Remembered per tablet so the rotation survives an app restart. Storage can be
// unavailable (private mode, cleared data); then it just starts from the first track.
const RESUME_KEY = 'birthdaySong.lastStop';

function readLastStop(): { track: number; fraction: number } | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v?.track === 'number' && typeof v?.fraction === 'number' ? v : null;
  } catch {
    return null;
  }
}

function writeLastStop(track: number, fraction: number): void {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ track, fraction })); } catch { /* storage unavailable */ }
}

// Playback lives at module level, not in a component, so the song keeps going when
// the cashier moves between the cashier list and the dashboard.
let current: { stop: () => void } | null = null;
let currentTrack: number | null = null;
const listeners = new Set<(track: number | null) => void>();

function setTrack(track: number | null): void {
  currentTrack = track;
  listeners.forEach((l) => l(track));
}

/** The playing track's index, or null when nothing is playing. */
export function getCurrentTrack(): number | null {
  return currentTrack;
}

/** Calls `listener` whenever the playing track changes. Returns an unsubscribe. */
export function subscribe(listener: (track: number | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Stops the song and gives audio focus back. Safe to call when nothing is playing. */
export function stopAll(): void {
  current?.stop();
  current = null;
  setTrack(null);
}

/**
 * Plays the playlist on a loop until stopAll(), starting where pickStartTrack says.
 * Takes audio focus first so music apps on the tablet pause. Resolves once playback has
 * started; rejects if the first track cannot play.
 */
export async function playBirthdayLoop(): Promise<void> {
  stopAll();
  if (Capacitor.isNativePlatform()) await Native.requestAudioFocus().catch(() => undefined);

  const el = new Audio();
  let index = 0;
  let stopped = false;

  const playAt = (i: number) => {
    index = i;
    el.src = PLAYLIST[i];
    setTrack(i);
    return el.play();
  };

  el.onended = () => { if (!stopped) void playAt(nextTrack(index)).catch(() => undefined); };
  // A broken file skips to the other song instead of going silent.
  el.onerror = () => { if (!stopped) void playAt(nextTrack(index)).catch(() => undefined); };

  current = {
    stop: () => {
      stopped = true;
      const fraction = el.duration > 0 ? el.currentTime / el.duration : 0;
      writeLastStop(index, fraction);
      el.onended = null;
      el.onerror = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
      if (Capacitor.isNativePlatform()) void Native.abandonAudioFocus().catch(() => undefined);
    },
  };

  try {
    await playAt(pickStartTrack(readLastStop()));
  } catch (e) {
    stopAll();
    throw e;
  }
}
