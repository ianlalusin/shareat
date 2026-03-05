'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Printer, Bluetooth, Check, RefreshCw, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ThermalPrinter, { type BluetoothDevice } from "@/lib/printing/thermalPrinter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Capacitor } from '@capacitor/core';
import { getLastPrinterAddress, setLastPrinterAddress, printViaNativeBluetooth } from "@/lib/printing/printHub";

export default function PrinterTestPage() {
  const { toast } = useToast();
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [paperWidth, setPaperWidth] = useState<"58" | "80">("80");
  const [isNative, setIsNative] = useState(true);

  useEffect(() => {
    const native = Capacitor.isNativePlatform();
    setIsNative(native);
    if (native) {
      refreshDevices();
      const stored = getLastPrinterAddress();
      if (stored) setConnectedAddress(stored);
    }
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

  const handleRequestPermissions = async () => {
    // Calling listBluetoothPrinters triggers the native permission flow if not granted
    await refreshDevices();
  };

  const handleConnect = async (address: string) => {
    setIsLoading(true);
    try {
      await ThermalPrinter.connectBluetoothPrinter({ address });
      setConnectedAddress(address);
      setLastPrinterAddress(address);
      toast({ title: 'Connected', description: 'Printer is ready.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Connection Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestPrint = async () => {
    if (!connectedAddress) return;
    setIsLoading(true);
    try {
      const text = `
--------------------------------
      PRINTER TEST PAGE
--------------------------------
Model: Thermal POS Printer
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
\n\n\n\n`;

      await printViaNativeBluetooth({
        target: 'receipt',
        text,
        widthMm: parseInt(paperWidth, 10) as any,
        cut: true,
        beep: true,
        encoding: 'CP437',
      });

      toast({ title: 'Print Job Sent' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Print Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isNative) {
    return (
      <RoleGuard allow={["admin", "manager"]}>
        <PageHeader title="Thermal Printer Setup" description="Native Bluetooth printing features." />
        <Card className="mt-6 border-amber-500 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <ShieldAlert /> Android App Required
            </CardTitle>
            <CardDescription className="text-amber-600 dark:text-amber-500">
              Bluetooth printing requires the native Android application build. It cannot be accessed directly from a standard web browser.
            </CardDescription>
          </CardHeader>
        </Card>
      </RoleGuard>
    );
  }

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader title="Thermal Printer Setup" description="Manage Bluetooth thermal printers for your Android device.">
        <Button variant="outline" onClick={handleRequestPermissions} disabled={isLoading}>
          <Bluetooth className="mr-2 h-4 w-4" /> Request Permissions
        </Button>
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-2 mt-6">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Paired Devices</CardTitle>
                <CardDescription>Select a paired Bluetooth printer.</CardDescription>
              </div>
              <Button size="icon" variant="ghost" onClick={refreshDevices} disabled={isLoading}>
                <RefreshCw className={isLoading ? "animate-spin" : ""} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {devices.length === 0 ? (
              <div className="text-sm text-muted-foreground py-10 text-center space-y-4">
                <p>No paired Bluetooth devices found.</p>
                <Button variant="outline" size="sm" onClick={refreshDevices}>Refresh List</Button>
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
                      <Button size="sm" onClick={() => handleConnect(device.address)} disabled={isLoading}>Connect</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Print Settings</CardTitle>
            <CardDescription>Configure and test your current connection.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Paper Width</label>
              <Select value={paperWidth} onValueChange={(v: any) => setPaperWidth(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="58">58mm (32 chars)</SelectItem>
                  <SelectItem value="80">80mm (48 chars)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="p-4 bg-muted rounded-lg text-sm space-y-1">
              <p><span className="text-muted-foreground">Current Printer:</span> {devices.find(d => d.address === connectedAddress)?.name || 'None'}</p>
              <p><span className="text-muted-foreground">Status:</span> {connectedAddress ? 'Online' : 'Disconnected'}</p>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={handleTestPrint} disabled={!connectedAddress || isLoading}>
              <Printer className="mr-2 h-4 w-4" /> Print Test Page
            </Button>
          </CardFooter>
        </Card>
      </div>
    </RoleGuard>
  );
}
