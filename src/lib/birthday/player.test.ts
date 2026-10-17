import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({}),
  Capacitor: { isNativePlatform: () => false },
}));

import { PLAYLIST, nextTrack } from './player';

describe('birthday playlist', () => {
  it('plays the SharEat song first, then Happy Birthday', () => {
    expect(PLAYLIST).toEqual(['/sounds/birthday-shareat.mp3', '/sounds/happy-birthday.mp3']);
  });

  it('loops back to the first song after the last', () => {
    expect(nextTrack(0)).toBe(1);
    expect(nextTrack(1)).toBe(0);
  });
});
