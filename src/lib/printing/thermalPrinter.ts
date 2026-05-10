'use client';

import { registerPlugin, Capacitor } from '@capacitor/core';

export interface BluetoothDevice {
  name: string;
  address: string;
}

export interface ThermalPrinterPlugin {
  listBluetoothPrinters(): Promise<{ devices: BluetoothDevice[] }>;
  connectBluetoothPrinter(options: { address: string }): Promise<void>;
  disconnectBluetoothPrinter(): Promise<void>;
  forgetPrinter(): Promise<void>;
  printQRCode(options: { data: string; size?: number }): Promise<void>;
  printPinSlip(options: {
    top: string;
    bottom: string;
    qrData?: string;
    qrSize?: number;
    encoding?: string;
    /**
     * Optional pre-rendered QR as base64-encoded PNG (no data: prefix).
     * When provided, the plugin renders the QR via raster image (centered
     * at the bitmap level, sidesteps printer firmware QR alignment bugs)
     * and ignores qrData/qrSize.
     */
    qrImageBase64?: string;
    /** Required when qrImageBase64 is set, so the plugin centers correctly. */
    paperWidthMm?: 58 | 80;
  }): Promise<void>;
  printReceipt(options: {
    text: string;
    widthMm: 58 | 80;
    cut?: boolean;
    beep?: boolean;
    encoding?: string;
    skipInit?: boolean;
  }): Promise<void>;
  printImage(options: {
    base64: string;
    widthMm?: 58 | 80;
    align?: 'left' | 'center' | 'right';
  }): Promise<void>;
}

const ThermalPrinter = registerPlugin<ThermalPrinterPlugin>('ThermalPrinter');

export default ThermalPrinter;

