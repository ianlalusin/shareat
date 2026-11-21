'use client';

/**
 * Photos on a thermal printer.
 *
 * The native printImage turns every pixel black or white at a 50% threshold —
 * right for a logo, but a face comes out as solid blobs. So photos are
 * pre-dithered here (Floyd–Steinberg) at the printer's exact dot width: the
 * plugin then sees an image that is already pure black and white, at its own
 * size, and prints the dot pattern unchanged — newspaper-photo style.
 */

/** Printer head width in dots at 203 dpi (matches ThermalPrinterPlugin). */
export function printerDots(widthMm: 58 | 80): number {
  return widthMm === 58 ? 384 : 576;
}

/**
 * Error-diffusion dither. `gray` is 0 (black) … 255 (white), row-major, and is
 * consumed. Returns one byte per pixel: 1 = print a black dot, 0 = paper.
 */
export function floydSteinberg(gray: Float32Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i];
      const black = old < 128;
      out[i] = black ? 1 : 0;
      const err = old - (black ? 0 : 255);
      if (x + 1 < w) gray[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) gray[i + w - 1] += (err * 3) / 16;
        gray[i + w] += (err * 5) / 16;
        if (x + 1 < w) gray[i + w + 1] += err / 16;
      }
    }
  }
  return out;
}

/**
 * JPEG/PNG (base64, no data: prefix) → print-ready PNG base64 at `widthPx`.
 * A little brightness and contrast lift first: thermal dots spread, so an
 * undithered-looking mid-grey would otherwise print too dark.
 */
export async function ditherForThermal(imageBase64: string, widthPx: number): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not read the photo.'));
    i.src = `data:image/jpeg;base64,${imageBase64}`;
  });
  const w = widthPx;
  const h = Math.max(1, Math.round((img.height / img.width) * w));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const l = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    gray[i] = Math.min(255, Math.max(0, (l - 128) * 1.15 + 128 + 18));
  }
  const dots = floydSteinberg(gray, w, h);
  for (let i = 0; i < w * h; i++) {
    const v = dots[i] ? 0 : 255;
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}
