
"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, NotFoundException, ChecksumException, FormatException } from "@zxing/library";

export interface UseBarcodeScannerOptions {
  onScan: (result: string) => void;
  scanMode: "single" | "continuous";
  dedupeMs?: number;
}

export function useBarcodeScanner({ onScan, scanMode, dedupeMs = 1000 }: UseBarcodeScannerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const lastScanRef = useRef<{ code: string, timestamp: number } | null>(null);

  const startScanning = async () => {
    setHasCameraPermission(null);
    setError(null);

    const codeReader = new BrowserMultiFormatReader();
    codeReaderRef.current = codeReader;
    
    const decodeCallback = (result: any, err: any) => {
        if (result) {
          const now = Date.now();
          const lastScan = lastScanRef.current;
          
          const throttleMs = scanMode === 'single' ? 300 : dedupeMs;

          if (!lastScan || result.getText() !== lastScan.code || (now - lastScan.timestamp) > throttleMs) {
            lastScanRef.current = { code: result.getText(), timestamp: now };
            onScan(result.getText());
          }
        }
        if (err && !(err instanceof NotFoundException) && !(err instanceof ChecksumException) && !(err instanceof FormatException)) {
          console.error("Barcode scanning error:", err);
          setError("An unexpected error occurred during scanning.");
        }
    };
    
    try {
      // First attempt: ideal "environment" facing mode for mobile back camera
      await codeReader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current!,
        decodeCallback
      );
      setHasCameraPermission(true);
    } catch (err: any) {
        console.warn("Failed to start with ideal facingMode, falling back to device list.", err);
        // Fallback to listing devices if the ideal mode fails
        try {
            const videoInputDevices = await codeReader.listVideoInputDevices();
            if (videoInputDevices.length === 0) {
                throw new Error("No video input devices found.");
            }

            // Prioritize back camera, then last device, then first device
            const rearCamera = videoInputDevices.find(device => device.label.toLowerCase().includes("back") || device.label.toLowerCase().includes("rear"));
            const selectedDeviceId = rearCamera 
                ? rearCamera.deviceId 
                : videoInputDevices.length > 1 
                    ? videoInputDevices[videoInputDevices.length - 1].deviceId // Often the back camera
                    : videoInputDevices[0].deviceId;

            await codeReader.decodeFromStream(
                await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: selectedDeviceId, width: { ideal: 1280 }, height: { ideal: 720 } },
                }),
                videoRef.current!,
                decodeCallback
            );
            setHasCameraPermission(true);
        } catch (finalErr: any) {
            console.error("Error accessing camera after fallback:", finalErr);
            let errorMessage = "An unexpected error occurred.";
            if (finalErr.name === 'NotAllowedError' || finalErr.name === 'PermissionDeniedError') {
                errorMessage = "Camera access was denied. Please enable camera permissions in your browser settings.";
            } else if (finalErr.name === 'NotFoundError' || finalErr.name === 'DevicesNotFoundError') {
                errorMessage = "No camera was found on your device.";
            }
            setError(errorMessage);
            setHasCameraPermission(false);
        }
    }
  };

  const stopScanning = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
    }
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  return {
    videoRef,
    error,
    hasCameraPermission,
    startScanning,
    stopScanning,
  };
}
