
"use client";

import { useEffect, useCallback } from "react";
import { useBarcodeScanner } from "./BaseBarcodeScanner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { Skeleton } from "../ui/skeleton";

interface SingleScanBarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
}

export function SingleScanBarcodeScanner({ 
  open, 
  onClose, 
  onScan,
  title = "Scan Barcode" 
}: SingleScanBarcodeScannerProps) {
  
  const handleScan = useCallback((code: string) => {
    onScan(code);
    onClose();
  }, [onScan, onClose]);

  const { videoRef, error, hasCameraPermission, startScanning, stopScanning } = useBarcodeScanner({
    onScan: handleScan,
    scanMode: "single",
  });

  useEffect(() => {
    if (open) {
      startScanning();
    } else {
      stopScanning();
    }

    return () => stopScanning();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Align barcode inside the frame. It will be scanned automatically.</DialogDescription>
        </DialogHeader>
        
        <div className="p-4 bg-black rounded-md overflow-hidden">
          {hasCameraPermission === null && <Skeleton className="w-full aspect-video" />}
          <video ref={videoRef} className={`w-full aspect-video rounded-md ${hasCameraPermission === null ? 'hidden' : ''}`} muted />
        </div>

        {error && (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Scanner Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
            </Alert>
        )}
        
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
