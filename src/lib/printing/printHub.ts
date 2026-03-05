'use client';

import { Capacitor } from '@capacitor/core';
import ThermalPrinter from '@/lib/printing/thermalPrinter';

export type PrintTarget = 'receipt' | 'pin';
export type PrintTransport = 'browser' | 'native_bluetooth' | 'webusb';

export type PrintJob = {
  target: PrintTarget;
  text?: string; // ESC/POS plain text payload
  widthMm?: 58 | 80;
  cut?: boolean;
  beep?: boolean;
  encoding?: string;
};

export function isNativeBluetoothAvailable() {
  return Capacitor.isNativePlatform();
}

export function getLastPrinterAddress() {
  try { return localStorage.getItem('last_printer_address'); } catch { return null; }
}

export function setLastPrinterAddress(address: string) {
  try { localStorage.setItem('last_printer_address', address); } catch {}
}

/**
 * Central print function for native bluetooth (Capacitor).
 * Keep UI pages thin and route all thermal jobs here.
 */
export async function printViaNativeBluetooth(job: Required<Pick<PrintJob, 'text'>> & PrintJob) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native Bluetooth printing is only available in the Android app build.');
  }

  const lastAddress = getLastPrinterAddress();
  if (!lastAddress) {
    throw new Error('No printer connected. Please configure printer in Settings.');
  }

  await ThermalPrinter.connectBluetoothPrinter({ address: lastAddress });
  await ThermalPrinter.printReceipt({
    text: job.text,
    widthMm: (job.widthMm ?? 80) as 58 | 80,
    cut: job.cut ?? true,
    beep: job.beep ?? true,
    encoding: job.encoding ?? 'CP437',
  });
}
