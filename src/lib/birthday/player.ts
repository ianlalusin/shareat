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

let current: { stop: () => void } | null = null;

/** Stops the song and gives audio focus back. Safe to call when nothing is playing. */
export function stopAll(): void {
  current?.stop();
  current = null;
}

/**
 * Plays the playlist on a loop until stopAll(). Takes audio focus first so music apps
 * on the tablet pause. Resolves once playback has started; rejects if the first track
 * cannot play.
 */
export async function playBirthdayLoop(onTrack?: (index: number) => void): Promise<void> {
  stopAll();
  if (Capacitor.isNativePlatform()) await Native.requestAudioFocus().catch(() => undefined);

  const el = new Audio();
  let index = 0;
  let stopped = false;

  const playAt = (i: number) => {
    index = i;
    el.src = PLAYLIST[i];
    onTrack?.(i);
    return el.play();
  };

  el.onended = () => { if (!stopped) void playAt(nextTrack(index)).catch(() => undefined); };
  // A broken file skips to the other song instead of going silent.
  el.onerror = () => { if (!stopped) void playAt(nextTrack(index)).catch(() => undefined); };

  current = {
    stop: () => {
      stopped = true;
      el.onended = null;
      el.onerror = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
      if (Capacitor.isNativePlatform()) void Native.abandonAudioFocus().catch(() => undefined);
    },
  };

  try {
    await playAt(0);
  } catch (e) {
    stopAll();
    throw e;
  }
}
