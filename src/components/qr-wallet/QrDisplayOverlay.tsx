"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Camera, CheckCircle2, ImageIcon, Loader2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useLocalProfile } from "@/context/local-profile-context";
import { capturePaymentProof } from "@/lib/payments/proof/capture";
import type { SavedQrCode } from "@/lib/types";

/**
 * Full-size QR shown to a customer to scan.
 *
 * Two render paths, and the distinction matters:
 *
 *  - `payload` present → re-render it as a crisp vector QR. Re-encoding is safe
 *    because the DATA is byte-identical; error-correction level and module size
 *    are presentation, and a scanner only reads the decoded bytes. A vector QR
 *    at screen resolution scans far better than a photo of a printed one.
 *
 *  - `payload` null (decode failed) → show the captured photo instead. A
 *    customer can still scan a photo off the screen, so a failed decode
 *    degrades the experience without breaking the feature.
 *
 * DISPLAY ONLY. Showing this records no tender anywhere — hence the standing
 * reminder line, which is the cheapest control against a payment being taken
 * and never rung up.
 */
export function QrDisplayOverlay({
  qr,
  storeId,
  onBack,
}: {
  qr: SavedQrCode;
  storeId: string | null;
  onBack: () => void;
}) {
  const releaseRef = useRef<null | (() => void)>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const isOnline = useOnlineStatus();
  const { currentProfile } = useLocalProfile();

  const [capturing, setCapturing] = useState(false);
  const [captured, setCaptured] = useState(0);

  /**
   * Snap the customer's confirmation screen once they have paid.
   *
   * Just the photo — no amount, no reference, no reading of the image. The sale
   * is rung up through the normal payment screen; this is a visual record.
   */
  const handleCapture = useCallback(
    async (file: File) => {
      if (!storeId) return;
      setCapturing(true);
      try {
        await capturePaymentProof({
          file,
          storeId,
          qr,
          localUserId: currentProfile?.profileId ?? null,
          isOnline,
        });
        setCaptured((n) => n + 1);
        toast({
          title: "Proof saved",
          description: isOnline
            ? "Photo saved to this sale's records."
            : "Saved on this device — it will upload when you're back online.",
        });
      } catch (error: any) {
        console.error("[QrDisplayOverlay] proof capture failed:", error);
        toast({
          variant: "destructive",
          title: "Couldn't save the photo",
          description: error?.message ?? "Please try again.",
        });
      } finally {
        setCapturing(false);
      }
    },
    [currentProfile?.profileId, isOnline, qr, storeId, toast],
  );

  // Keep the screen awake — a tablet that sleeps mid-scan makes staff think the
  // QR is broken. Best-effort: unsupported in some WebViews, and that is fine.
  useEffect(() => {
    let cancelled = false;
    const anyNav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };

    anyNav.wakeLock
      ?.request("screen")
      .then((sentinel) => {
        if (cancelled) {
          void sentinel.release();
          return;
        }
        releaseRef.current = () => void sentinel.release();
      })
      .catch(() => {
        /* Wake lock is a nicety, never a requirement. */
      });

    return () => {
      cancelled = true;
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, []);

  const warnings = qr.meta?.warnings ?? [];
  const hasAmount = warnings.includes("has_amount");

  return (
    <div className="absolute inset-0 z-50 overflow-y-auto rounded-lg bg-background/98 animate-in fade-in-0 zoom-in-95 duration-200">
      <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex flex-col items-center gap-1">
          <h3 className="text-xl font-semibold">{qr.name}</h3>
          {qr.meta?.merchantName && qr.meta.merchantName !== qr.name && (
            <p className="text-sm text-muted-foreground">{qr.meta.merchantName}</p>
          )}
          {qr.meta?.maskedAccount && (
            <p className="text-sm tabular-nums text-muted-foreground">{qr.meta.maskedAccount}</p>
          )}
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          {qr.payload ? (
            <QRCodeSVG
              value={qr.payload}
              level="M"
              marginSize={2}
              className="h-auto w-[min(72vw,52vh)] max-w-[420px]"
            />
          ) : (
            // Only reachable for a doc saved by an older build, which stored a
            // photo instead of a payload. Nothing here can render a scannable
            // code from that, so say so plainly rather than showing a picture
            // the customer's bank app may or may not read.
            <div className="flex h-[min(72vw,52vh)] max-h-[420px] w-[min(72vw,52vh)] max-w-[420px] flex-col items-center justify-center gap-2 p-6 text-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground opacity-50" />
              <p className="text-sm font-medium text-foreground">This QR needs re-scanning</p>
              <p className="text-sm text-muted-foreground">
                It was saved before the scanner was added. Ask a manager to edit it and scan
                the code again.
              </p>
            </div>
          )}
        </div>

        {hasAmount && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-500">
            <ShieldAlert className="h-4 w-4 shrink-0" />
            This QR has a fixed amount baked in.
          </p>
        )}

        {/* The control mitigation. Showing a QR records no tender, so this line
            is the only thing standing between "customer paid" and "sale never
            rung up". Deliberately always visible, not a dismissible toast. */}
        <p className="max-w-sm text-sm text-muted-foreground">
          Display only — record this payment in the payment screen.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleCapture(file);
          }}
        />

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={capturing || !storeId}
          >
            {capturing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Camera className="mr-2 h-4 w-4" />
            )}
            {captured > 0 ? "Take another photo" : "Take proof of payment"}
          </Button>

          <Button variant="outline" onClick={onBack} disabled={capturing}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to wallet
          </Button>
        </div>

        {captured > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-500">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {captured === 1 ? "1 photo saved" : `${captured} photos saved`}
            <span className="text-muted-foreground">· kept for 15 days</span>
          </p>
        )}
      </div>
    </div>
  );
}
