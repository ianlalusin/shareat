'use client';

import { registerPlugin, Capacitor } from '@capacitor/core';
import type { PinQrMode } from './pinQr';

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
    /** How the QR is sent (see pinQr.ts). Omitted = 'raster-full', the pre-2026-09 path. */
    qrMode?: PinQrMode;
    /** QR symbol width in modules; native mode needs it to centre the printer-drawn QR. */
    qrModules?: number;
  }): Promise<void>;
  /** One slip with a labelled sample of every PinQrMode, for picking what this printer scans best. */
  printQrTest(options: {
    qrImageBase64: string;
    qrData: string;
    qrModules: number;
    /** Module size for the printer-drawn sample (D); image samples use the PNG as rendered. */
    moduleDots: number;
    paperWidthMm: 58 | 80;
  }): Promise<void>;
  printReceipt(options: {
    text: string;
    widthMm: 58 | 80;
    cut?: boolean;
    beep?: boolean;
    encoding?: string;
    skipInit?: boolean;
    /** Thermal font: small=Font B, normal=Font A, large=Font A double-height. */
    font?: 'small' | 'normal' | 'large';
  }): Promise<void>;
  printImage(options: {
    base64: string;
    widthMm?: 58 | 80;
    align?: 'left' | 'center' | 'right';
    /** Logo width as a % of paper width (20-100). Omit to use the default. */
    widthPct?: number;
  }): Promise<void>;
}

const ThermalPrinter = registerPlugin<ThermalPrinterPlugin>('ThermalPrinter');

export default ThermalPrinter;

