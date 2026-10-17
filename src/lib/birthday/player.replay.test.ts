import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({}),
  Capacitor: { isNativePlatform: () => false },
}));

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  currentTime = 0;
  duration = 100;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { FakeAudio.instances.push(this); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
}

const store: Record<string, string> = {};
beforeEach(() => {
  FakeAudio.instances = [];
  for (const k of Object.keys(store)) delete store[k];
  (globalThis as any).Audio = FakeAudio;
  (globalThis as any).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
  };
});

describe('play, stop halfway, play again', () => {
  it('starts playing again with the same song', async () => {
    const { playBirthdayLoop, stopAll, getCurrentTrack } = await import('./player');
    await playBirthdayLoop();
    expect(getCurrentTrack()).toBe(0);
    const first = FakeAudio.instances.at(-1)!;
    first.currentTime = 40; // 40% in
    await stopAll();
    expect(getCurrentTrack()).toBe(null);

    await playBirthdayLoop();
    const second = FakeAudio.instances.at(-1)!;
    expect(getCurrentTrack()).toBe(0);
    expect(second.paused).toBe(false);
    expect(second.src).toContain('birthday-shareat.mp3');
  });
});
