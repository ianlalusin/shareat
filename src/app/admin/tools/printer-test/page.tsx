'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, Bluetooth, Check, RefreshCw, ShieldAlert, Usb } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ThermalPrinter, { type BluetoothDevice } from "@/lib/printing/thermalPrinter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Capacitor } from '@capacitor/core';
import { getLastPrinterAddress, setLastPrinterAddress, printViaNativeBluetooth, printViaWebUSB } from "@/lib/printing/printHub";

export default function PrinterTestPage() {
  const { toast } = useToast();

  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [paperWidth, setPaperWidth] = useState<"58" | "80">("80");

  const [isNative, setIsNative] = useState(false);
  const [hasWebUSB, setHasWebUSB] = useState(false);

  const [webusbSelected, setWebusbSelected] = useState(false);
  const [webusbLastInfo, setWebusbLastInfo] = useState<string | null>(null);

  useEffect(() => {
    const native = Capacitor.isNativePlatform();
    setIsNative(native);

    // runtime feature detect (avoid TS DOM lib requirements)
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
      toast({ variant: 'destructive', title: 'Permissions or Bluetooth Error', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectBluetooth = async (address: string) => {
    setIsLoading(true);
    try {
      await ThermalPrinter.connectBluetoothPrinter({ address });
      setConnectedAddress(address);
      setLastPrinterAddress(address);
      toast({ title: 'Bluetooth Connected', description: 'Printer is ready.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Bluetooth Connection Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const buildTestText = () => `
--------------------------------
      PRINTER TEST PAGE
--------------------------------
Mode: ${isNative ? 'Bluetooth / Android App' : 'Browser'}
Width: ${paperWidth}mm
Time: ${new Date().toLocaleString()}
--------------------------------
12345678901234567890123456789012
ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz
!@#$%^&*()_+-=[]{}|;':",.<>/?
--------------------------------
      TEST COMPLETE
--------------------------------
`;

  const handleTestPrintBluetooth = async () => {
    if (!connectedAddress) return;
    setIsLoading(true);
    try {
      const text = buildTestText() + `\n\n\n\n`;
      await printViaNativeBluetooth({
        target: 'receipt',
        text,
        widthMm: parseInt(paperWidth, 10) as any,
        cut: true,
        beep: true,
        encoding: 'CP437',
      });
      toast({ title: 'Print Job Sent (Bluetooth)' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Bluetooth Print Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectUsbPrinter = async () => {
    setIsLoading(true);
    try {
      // user gesture required; also acts as a quick connection test (no cut)
      const res = await printViaWebUSB({ target: 'receipt', text: ' ', cut: false });
      setWebusbSelected(true);
      setWebusbLastInfo(`VID ${res.vendorId} / PID ${res.productId}`);
      toast({ title: 'USB Printer Selected', description: 'Ready for WebUSB printing.' });
    } catch (e: any) {
      setWebusbSelected(false);
      toast({ variant: 'destructive', title: 'WebUSB Select Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestPrintUsb = async () => {
    setIsLoading(true);
    try {
      const text = buildTestText();
      const res = await printViaWebUSB({ target: 'receipt', text, cut: true });
      setWebusbSelected(true);
      setWebusbLastInfo(`VID ${res.vendorId} / PID ${res.productId}`);
      toast({ title: 'Print Job Sent (WebUSB)' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'WebUSB Print Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader title="Printer Setup" description="Bluetooth (Android app) and WebUSB (browser) connections." />

      <div className="grid gap-6 md:grid-cols-2 mt-6">
        {/* Bluetooth (Native) */}
        <Card className={!isNative ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20" : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bluetooth className="h-5 w-5" /> Bluetooth (Android App)
            </CardTitle>
            <CardDescription>
              {isNative
                ? "Pair and connect to a Bluetooth thermal printer."
                : "Disabled in browser. Requires the Android app build."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {!isNative ? (
              <div className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <ShieldAlert className="h-4 w-4 mt-0.5" />
                <span>Bluetooth printing only works on the native Android build.</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">Paired Devices</div>
                  <Button size="icon" variant="ghost" onClick={refreshDevices} disabled={isLoading}>
                    <RefreshCw className={isLoading ? "animate-spin" : ""} />
                  </Button>
                </div>

                {devices.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center space-y-3">
                    <p>No paired Bluetooth devices found.</p>
                    <Button variant="outline" size="sm" onClick={refreshDevices} disabled={isLoading}>
                      Refresh List
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {devices.map(device => (
                      <div key={device.address} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                        <div>
                          <p className="font-medium">{device.name || 'Unknown Device'}</p>
                          <p className="text-xs text-muted-foreground font-mono">{device.address}</p>
                        </div>
                        {connectedAddress === device.address ? (
                          <Badge className="bg-green-600"><Check className="mr-1 h-3 w-3" /> Connected</Badge>
                        ) : (
                          <Button size="sm" onClick={() => handleConnectBluetooth(device.address)} disabled={isLoading}>
                            Connect
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                  <p><span className="text-muted-foreground">Status:</span> {connectedAddress ? 'Online' : 'Disconnected'}</p>
                </div>
              </>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <div className="w-full space-y-2">
              <label className="text-sm font-medium">Paper Width</label>
              <Select value={paperWidth} onValueChange={(v: any) => setPaperWidth(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="58">58mm (32 chars)</SelectItem>
                  <SelectItem value="80">80mm (48 chars)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button className="w-full" onClick={handleTestPrintBluetooth} disabled={!isNative || !connectedAddress || isLoading}>
              <Printer className="mr-2 h-4 w-4" /> Print Test Page (Bluetooth)
            </Button>
          </CardFooter>
        </Card>

        {/* WebUSB (Browser) */}
        <Card className={!hasWebUSB ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20" : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Usb className="h-5 w-5" /> WebUSB (Browser + USB Cable)
            </CardTitle>
            <CardDescription>
              {hasWebUSB
                ? "Connect directly to a USB thermal printer (ESC/POS)."
                : "Not supported in this browser/environment."}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
              <p><span className="text-muted-foreground">Status:</span> {webusbSelected ? 'Selected' : 'Not selected'}</p>
              <p><span className="text-muted-foreground">Device:</span> {webusbLastInfo || '—'}</p>
            </div>

            <Button variant="outline" onClick={handleSelectUsbPrinter} disabled={!hasWebUSB || isLoading} className="w-full">
              <Usb className="mr-2 h-4 w-4" /> Select USB Printer
            </Button>
          </CardContent>

          <CardFooter>
            <Button onClick={handleTestPrintUsb} disabled={!hasWebUSB || !webusbSelected || isLoading} className="w-full">
              <Printer className="mr-2 h-4 w-4" /> Print Test Page (WebUSB)
            </Button>
          </CardFooter>
        </Card>
      </div>
    </RoleGuard>
  );
}
