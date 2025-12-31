
"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/library";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { AlertCircle } from "lucide-react";

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

export function BarcodeScanner({ isOpen, onClose, onScan }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    const codeReader = new BrowserMultiFormatReader();
    let selectedDeviceId: string | undefined;

    const getCameraPermission = async () => {
      try {
        const videoInputDevices = await codeReader.listVideoInputDevices();
        if (videoInputDevices.length === 0) {
          setError("No video input devices found.");
          setHasCameraPermission(false);
          return;
        }

        selectedDeviceId = videoInputDevices[0].deviceId;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: selectedDeviceId },
        });
        setHasCameraPermission(true);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        codeReader.decodeFromVideoDevice(selectedDeviceId, videoRef.current!, (result, err) => {
          if (result) {
            onScan(result.getText());
          }
          if (err && !(err instanceof NotFoundException)) {
            console.error("Barcode scanning error:", err);
          }
        });

      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("Camera access denied. Please enable camera permissions in your browser settings.");
        setHasCameraPermission(false);
      }
    };

    getCameraPermission();

    return () => {
      codeReader.reset();
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isOpen, onScan]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scan Barcode</DialogTitle>
          <DialogDescription>Position the barcode within the camera view.</DialogDescription>
        </DialogHeader>
        
        <div className="p-4 bg-black rounded-md">
            <video ref={videoRef} className="w-full aspect-video rounded-md" autoPlay muted />
        </div>

        {!hasCameraPermission && (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Camera Access Required</AlertTitle>
                <AlertDescription>
                   {error || "Please enable camera permissions in your browser settings to use the scanner."}
                </AlertDescription>
            </Alert>
        )}
        
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
