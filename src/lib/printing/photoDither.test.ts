import { describe, expect, it } from 'vitest';
import { floydSteinberg, printerDots } from './photoDither';

describe('photo dithering for thermal paper', () => {
  it('maps paper width to printer dots', () => {
    expect(printerDots(58)).toBe(384);
    expect(printerDots(80)).toBe(576);
  });

  it('keeps pure black and pure white exact', () => {
    expect([...floydSteinberg(new Float32Array([0, 0, 0, 0]), 2, 2)]).toEqual([1, 1, 1, 1]);
    expect([...floydSteinberg(new Float32Array([255, 255, 255, 255]), 2, 2)]).toEqual([0, 0, 0, 0]);
  });

  it('turns mid-grey into roughly half black dots', () => {
    const w = 64;
    const h = 64;
    const dots = floydSteinberg(new Float32Array(w * h).fill(128), w, h);
    const black = dots.reduce((a, d) => a + d, 0) / (w * h);
    expect(black).toBeGreaterThan(0.4);
    expect(black).toBeLessThan(0.6);
  });
});
