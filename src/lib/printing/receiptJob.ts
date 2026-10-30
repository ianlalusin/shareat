// Builds the native (Bluetooth) receipt print job. Pure, so the paper width the
// cashier picked on screen can be checked to reach the printer unchanged.

import { formatReceiptText } from "./receiptFormatter";
import type { ReceiptData, ReceiptSettings } from "@/lib/types";

export type PaperWidth = "58mm" | "80mm";

export interface NativeReceiptJob {
  target: "receipt";
  text: string;
  widthMm: 58 | 80;
  cut: boolean;
  beep: boolean;
  encoding: "CP437";
  showLogo: boolean;
  logoWidthPct?: number;
  font: "small" | "normal" | "large";
  storeId: string | null | undefined;
}

/**
 * `selectedPaperWidth`, when given, wins over the store default in `settings`
 * so the native output matches the on-screen preview and browser print.
 */
export function buildNativeReceiptJob(
  receiptData: ReceiptData,
  settings: ReceiptSettings,
  storeId: string | null | undefined,
  selectedPaperWidth?: PaperWidth,
): NativeReceiptJob {
  const effective: ReceiptSettings = selectedPaperWidth
    ? { ...settings, paperWidth: selectedPaperWidth }
    : settings;
  const widthMm: 58 | 80 = effective.paperWidth === "58mm" ? 58 : 80;
  // A thermal printer only has built-in ROM fonts, so the CSS fontFamily can't
  // apply on paper. Map the numeric fontSize to the three sizes the printer can
  // do: small = Font B, normal = Font A, large = Font A double-height.
  const fontSizeVal = effective.fontSize ?? 12;
  const font: "small" | "normal" | "large" =
    fontSizeVal <= 10 ? "small" : fontSizeVal >= 14 ? "large" : "normal";
  const text = formatReceiptText({ ...receiptData, settings: effective }, widthMm, font);
  return {
    target: "receipt",
    text,
    widthMm,
    cut: true,
    beep: true,
    encoding: "CP437",
    showLogo: effective.showLogo ?? false,
    logoWidthPct: effective.logoWidthPct,
    font,
    storeId,
  };
}
