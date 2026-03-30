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
  printQRCode(options: { data: string; size?: number }): Promise<void>;
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

