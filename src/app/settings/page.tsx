'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, Bluetooth, RefreshCw, Usb, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ThermalPrinter, { type BluetoothDevice } from "@/lib/printing/thermalPrinter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Capacitor } from '@capacitor/core';
import { getLastPrinterAddress, setLastPrinterAddress, printViaNativeBluetooth, printViaWebUSB } from "@/lib/printing/printHub";

export default function SettingsPage() {
  const { toast } = useToast();
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [paperWidth, setPaperWidth] = useState<"58" | "80">("80");
  const [isNative, setIsNative] = useState(false);
  const [hasWebUSB, setHasWebUSB] = useState(false);
  const [webusbSelected, setWebusbSelected] = useState(false);

  useEffect(() => {
    const native = Capacitor.isNativePlatform();
    setIsNative(native);
    setHasWebUSB(typeof navigator !== 'undefined' && 'usb' in (navigator as any));
    const stored = getLastPrinterAddress();
    if (stored) setConnectedAddress(stored);
    if (native) refreshDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshDevices = async () => {
    if (!Capacitor.isNativePlatform()) return;
    setIsLoading(true);
    try {
      const { devices } = await ThermalPrinter.listBluetoothPrinters();
      setDevices(devices);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Bluetooth Error', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async (address: string) => {
    setIsLoading(true);
    try {
      await ThermalPrinter.connectBluetoothPrinter({ address });
      setLastPrinterAddress(address);
      setConnectedAddress(address);
      toast({ title: 'Bluetooth Connected', description: 'Printer is ready.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Connection Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestPrintBluetooth = async () => {
    setIsLoading(true);
    try {
      await printViaNativeBluetooth({
        target: 'receipt',
        text: `TEST PRINT\n\nPaper: ${paperWidth}mm\nBluetooth OK\n\n\n`,
        widthMm: parseInt(paperWidth) as 58 | 80,
        cut: true,
        beep: false,
      });
      toast({ title: 'Test Sent', description: 'Check your printer output.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Print Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectUsbPrinter = async () => {
    setIsLoading(true);
    try {
      await printViaWebUSB({ target: 'receipt', text: 'TEST PRINT\n\n\n', cut: true });
      setWebusbSelected(true);
      toast({ title: 'USB Printer Selected', description: 'Ready for WebUSB printing.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'USB Error', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <PageHeader title="Settings" description="Printer and device configuration." />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bluetooth className="h-5 w-5" /> Bluetooth Printer
            </CardTitle>
            <CardDescription>
              {isNative
                ? 'Select a paired Bluetooth thermal printer for the Android app.'
                : 'Only available in the Android APK build.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {connectedAddress && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-500" />
                Saved: <Badge variant="secondary">{connectedAddress}</Badge>
              </div>
            )}
            {isNative && (
              <>
                <div className="flex gap-2">
                  <Select
                    value={connectedAddress ?? ''}
                    onValueChange={handleConnect}
                    disabled={isLoading || devices.length === 0}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={devices.length === 0 ? 'No devices found' : 'Select printer'} />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.map(d => (
                        <SelectItem key={d.address} value={d.address}>
                          {d.name} ({d.address})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={refreshDevices} disabled={isLoading}>
                    <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={paperWidth} onValueChange={(v) => setPaperWidth(v as "58" | "80")}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="58">58mm</SelectItem>
                      <SelectItem value="80">80mm</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={handleTestPrintBluetooth} disabled={isLoading || !connectedAddress}>
                    <Printer className="mr-2 h-4 w-4" /> Print Test
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Usb className="h-5 w-5" /> USB Printer (WebUSB)
            </CardTitle>
            <CardDescription>Connect a USB thermal printer directly from the browser.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {webusbSelected && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-500" /> USB printer selected
              </div>
            )}
            <Button variant="outline" onClick={handleSelectUsbPrinter} disabled={!hasWebUSB || isLoading}>
              <Usb className="mr-2 h-4 w-4" /> Select USB Printer
            </Button>
            {!hasWebUSB && (
              <p className="text-sm text-muted-foreground">WebUSB is not supported in this browser.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
