'use client';

import { registerPlugin } from '@capacitor/core';

export interface BluetoothDevice {
  name: string;
  address: string;
}

export interface ThermalPrinterPlugin {
  listBluetoothPrinters(): Promise<{ devices: BluetoothDevice[] }>;
  connectBluetoothPrinter(options: { address: string }): Promise<void>;
  disconnectBluetoothPrinter(): Promise<void>;
  printReceipt(options: { text: string; widthMm: 58 | 80; cut?: boolean; beep?: boolean }): Promise<void>;
}

const ThermalPrinter = registerPlugin<ThermalPrinterPlugin>('ThermalPrinter');

export default ThermalPrinter;

/**
 * High-level wrapper for printing
 */
export async function printToThermal(text: string, widthMm: 58 | 80 = 80) {
  try {
    // Check if we have a saved printer
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
      beep: true
    });
  } catch (error: any) {
    console.error('[ThermalPrinter] Print failed:', error);
    throw error;
  }
}
