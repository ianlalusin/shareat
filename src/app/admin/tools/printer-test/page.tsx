'use client';

import { useState, useEffect } from 'react';
import { PageHeader } from "@/components/page-header";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Printer, Bluetooth, Check, RefreshCw, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ThermalPrinter, { type BluetoothDevice } from "@/lib/printing/thermalPrinter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function PrinterTestPage() {
  const { toast } = useToast();
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [paperWidth, setPaperWidth] = useState<"58" | "80">("80");

  useEffect(() => {
    refreshDevices();
    const stored = localStorage.getItem('last_printer_address');
    if (stored) setConnectedAddress(stored);
  }, []);

  const refreshDevices = async () => {
    setIsLoading(true);
    try {
      const { devices } = await ThermalPrinter.listBluetoothPrinters();
      setDevices(devices);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async (address: string) => {
    setIsLoading(true);
    try {
      await ThermalPrinter.connectBluetoothPrinter({ address });
      setConnectedAddress(address);
      localStorage.setItem('last_printer_address', address);
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
      await ThermalPrinter.printReceipt({
        text,
        widthMm: parseInt(paperWidth) as any,
        cut: true,
        beep: true
      });
      toast({ title: 'Print Job Sent' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Print Failed', description: e.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader title="Thermal Printer Setup" description="Manage Bluetooth thermal printers for your Android device." />
      
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
              <p className="text-sm text-muted-foreground py-4 text-center">No paired Bluetooth devices found.</p>
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
