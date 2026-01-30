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
  printReceipt(options: { 
    text: string; 
    widthMm: 58 | 80; 
    cut?: boolean; 
    beep?: boolean;
    encoding?: string;
  }): Promise<void>;
}

const ThermalPrinter = registerPlugin<ThermalPrinterPlugin>('ThermalPrinter');

export default ThermalPrinter;

/**
 * High-level wrapper for printing with environment safety checks.
 */
export async function printToThermal(text: string, widthMm: 58 | 80 = 80) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native Bluetooth printing is only available in the Android app build.');
  }

  try {
    const lastAddress = localStorage.getItem('last_printer_address');
    if (lastAddress) {
      await ThermalPrinter.connectBluetoothPrinter({ address: lastAddress });
    } else {
      throw new Error('No printer connected. Please configure printer in Settings.');
    }

    await ThermalPrinter.printReceipt({
      text,
      widthMm,
      cut: true,
      beep: true,
      encoding: 'CP437'
    });
  } catch (error: any) {
    console.error('[ThermalPrinter] Print failed:', error);
    throw error;
  }
}
