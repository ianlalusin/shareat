import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({}),
  Capacitor: { isNativePlatform: () => false },
}));

import { PLAYLIST, nextTrack, pickStartTrack } from './player';

describe('birthday playlist', () => {
  it('plays the SharEat song first, then Happy Birthday', () => {
    expect(PLAYLIST).toEqual(['/sounds/birthday-shareat.mp3', '/sounds/happy-birthday.mp3']);
  });

  it('loops back to the first song after the last', () => {
    expect(nextTrack(0)).toBe(1);
    expect(nextTrack(1)).toBe(0);
  });
});

describe('where the next play starts', () => {
  it('starts with the first song when nothing was played yet', () => {
    expect(pickStartTrack(null)).toBe(0);
  });

  it('moves to the next song when the last one was stopped at 75% or later', () => {
    expect(pickStartTrack({ track: 0, fraction: 0.75 })).toBe(1);
    expect(pickStartTrack({ track: 1, fraction: 0.9 })).toBe(0);
  });

  it('replays the same song when it was stopped before 75%', () => {
    expect(pickStartTrack({ track: 0, fraction: 0.74 })).toBe(0);
    expect(pickStartTrack({ track: 1, fraction: 0.1 })).toBe(1);
  });

  it('ignores a remembered track that no longer exists', () => {
    expect(pickStartTrack({ track: 5, fraction: 0.9 })).toBe(0);
  });
});
