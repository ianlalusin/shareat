"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, ScanLine, ShieldAlert, Trash2 } from "lucide-react";
import { collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { auth, db, storage } from "@/lib/firebase/client";
import { guessProvider, maskAccountTail, parseEmvQr, type EmvQrInfo } from "@/lib/qr/emvco";
import { initialsBadge } from "@/lib/qr/initials";
import { cn } from "@/lib/utils";
import type { SavedQrCode } from "@/lib/types";

import { QrScanner } from "./QrScanner";

type IconCandidate = {
  id: string;
  source: string;
  contentType: string;
  bytesBase64: string;
};

type Stage = "scan" | "details";

export type AddQrDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  /** Existing entry to edit, or null to create. */
  editing: SavedQrCode | null;
};

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

/**
 * Add or edit a saved QR.
 *
 * THE WALLET STORES DATA, NOT PICTURES. The manager scans the QR live; we keep
 * the decoded EMVCo payload and every tile re-renders it as a fresh, crisp code.
 * No photograph is captured or uploaded, because a photo of a QR is strictly
 * worse to show a customer than a QR generated from the same data — it is
 * softer, it carries the glare and skew of the original shot, and it cannot be
 * resized cleanly.
 *
 * Nothing is saved until a payload is in hand, which is what makes a scanner
 * the right input: a still capture that fails to decode leaves nothing usable,
 * whereas a scanner just keeps reading.
 */
export function AddQrDialog({ open, onOpenChange, storeId, editing }: AddQrDialogProps) {
  const { toast } = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();

  /** Id for this dialog session, fixed on open — also the icon's Storage folder. */
  const draftIdRef = useRef<string>("");

  const [stage, setStage] = useState<Stage>("scan");
  const [saving, setSaving] = useState(false);

  const [payload, setPayload] = useState<string | null>(null);
  const [info, setInfo] = useState<EmvQrInfo | null>(null);

  const [name, setName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const [icons, setIcons] = useState<IconCandidate[]>([]);
  const [iconBusy, setIconBusy] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);

  const isEditing = editing !== null;

  useEffect(() => {
    if (!open) return;
    draftIdRef.current = editing?.id ?? crypto.randomUUID();
    if (editing) {
      setStage("details");
      setPayload(editing.payload ?? null);
      setInfo(editing.payload ? parseEmvQr(editing.payload) : null);
      setName(editing.name);
    } else {
      setStage("scan");
      setPayload(null);
      setInfo(null);
      setName("");
    }
    setAcknowledged(false);
    setIcons([]);
    setSelectedIcon(null);
    setSaving(false);
  }, [open, editing]);

  const warnings = info?.warnings ?? [];
  const hasAmount = warnings.includes("has_amount");
  const isDynamic = warnings.includes("dynamic_initiation");
  const crcFailed = info !== null && !info.crcValid;
  const notEmv = info !== null && !info.isEmv;
  const needsAck = hasAmount || isDynamic || crcFailed || notEmv;

  const provider = useMemo(() => guessProvider(info, name), [info, name]);
  const fallbackBadge = useMemo(() => initialsBadge(name || "QR"), [name]);

  /** A payload came off the scanner. Parse it and move to the details step. */
  const handleScan = useCallback(
    (scanned: string) => {
      const parsed = parseEmvQr(scanned);
      setInfo(parsed);
      // Stored VERBATIM — never re-serialized from the parsed fields.
      setPayload(parsed.raw);
      if (!name && parsed.merchantName) setName(parsed.merchantName);
      setStage("details");
    },
    [name],
  );

  /** Icon suggestion. Entirely optional — failure never blocks the save. */
  const fetchIcons = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setIconBusy(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not signed in.");
      const params = new URLSearchParams({ storeId, name: trimmed, provider });
      const res = await fetch(`/api/qr-wallet/icon?${params}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Icon lookup failed.");
      setIcons(data.candidates ?? []);
      if ((data.candidates ?? []).length === 0) {
        toast({ title: "No logo found", description: "The initials badge will be used." });
      }
    } catch (error: any) {
      console.warn("[AddQrDialog] icon lookup failed:", error);
      setIcons([]);
      toast({ title: "Couldn't fetch logos", description: "The initials badge will be used." });
    } finally {
      setIconBusy(false);
    }
  }, [name, provider, storeId, toast]);

  const handleSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !payload) return;

    setSaving(true);
    try {
      const qrId = draftIdRef.current;
      const badge = initialsBadge(trimmed);

      let iconUrl: string | null = editing?.iconUrl ?? null;
      let iconStoragePath: string | null = editing?.iconStoragePath ?? null;
      let iconSource: SavedQrCode["iconSource"] = editing?.iconSource ?? "initials";

      const chosen = icons.find((candidate) => candidate.id === selectedIcon);
      if (chosen) {
        const extension = EXTENSION_BY_TYPE[chosen.contentType] ?? "png";
        const path = `stores/${storeId}/qrWallet/${qrId}/icon-${Date.now()}.${extension}`;
        const target = storageRef(storage, path);
        await uploadBytes(target, base64ToBlob(chosen.bytesBase64, chosen.contentType), {
          contentType: chosen.contentType,
        });
        iconUrl = await getDownloadURL(target);
        iconStoragePath = path;
        iconSource = chosen.source === "simpleicons" ? "simpleicons" : "favicon";
      } else if (selectedIcon === "initials") {
        iconUrl = null;
        iconStoragePath = null;
        iconSource = "initials";
      }

      const meta: SavedQrCode["meta"] = info
        ? {
            merchantName: info.merchantName,
            merchantCity: info.merchantCity,
            countryCode: info.countryCode,
            currency: info.currency,
            mcc: info.mcc,
            initiationMethod: info.initiationMethod,
            accountGuids: info.merchantAccounts.map((a) => a.guid ?? "").filter(Boolean),
            maskedAccount: maskAccountTail(info),
            crcValid: info.crcValid,
            warnings: info.warnings,
          }
        : {};

      if (editing) {
        await updateDoc(doc(db, "stores", storeId, "savedQrCodes", editing.id), {
          name: trimmed,
          provider,
          payload,
          meta,
          iconUrl,
          iconStoragePath,
          iconSource,
          iconInitials: badge.initials,
          iconColor: badge.color,
          updatedAt: serverTimestamp(),
          updatedByUid: auth.currentUser?.uid ?? "",
        });
      } else {
        const target = doc(collection(db, "stores", storeId, "savedQrCodes"), qrId);
        const record: SavedQrCode = {
          id: qrId,
          storeId,
          name: trimmed,
          provider,
          sortOrder: 1000,
          isActive: true,
          payload,
          meta,
          iconUrl,
          iconStoragePath,
          iconSource,
          iconInitials: badge.initials,
          iconColor: badge.color,
          createdAt: serverTimestamp(),
          createdAtMs: Date.now(),
          createdByUid: auth.currentUser?.uid ?? "",
          createdByName: auth.currentUser?.displayName ?? null,
          updatedAt: serverTimestamp(),
        };
        await setDoc(target, record);
      }

      toast({ title: isEditing ? "QR updated" : "QR saved", description: trimmed });
      onOpenChange(false);
    } catch (error: any) {
      console.error("[AddQrDialog] save failed:", error);
      toast({
        variant: "destructive",
        title: "Couldn't save",
        description: error?.message ?? "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }, [
    editing,
    icons,
    info,
    isEditing,
    name,
    onOpenChange,
    payload,
    provider,
    selectedIcon,
    storeId,
    toast,
  ]);

  const handleDelete = useCallback(async () => {
    if (!editing) return;
    const ok = await confirm({
      title: `Delete "${editing.name}"?`,
      description: "It will be removed from the wallet. This cannot be undone.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "stores", storeId, "savedQrCodes", editing.id));
      toast({ title: "QR deleted", description: editing.name });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Couldn't delete",
        description: error?.message ?? "Please try again.",
      });
    }
  }, [confirm, editing, onOpenChange, storeId, toast]);

  const canSave = !!name.trim() && !!payload && !saving && (!needsAck || acknowledged);

  const ackMessage = crcFailed
    ? "This code's checksum doesn't match, so it may have been misread. Re-scan it if you can — if you save it anyway, test it with a wallet app before using it at the till."
    : notEmv
      ? "This doesn't look like a payment QR. It will still be saved and shown exactly as scanned."
      : hasAmount
        ? `This QR has a fixed amount of ₱${info?.amount} baked in. Every customer would be charged that exact amount.`
        : "This is a one-time QR and will stop working after it is used.";

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit QR code" : "Add QR code"}</DialogTitle>
          <DialogDescription>
            {stage === "scan"
              ? "Scan the QR code. Only its data is saved — the wallet regenerates the code itself."
              : "Name it and pick an icon."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {stage === "scan" && (
            <QrScanner onResult={handleScan} onCancel={() => onOpenChange(false)} />
          )}

          {stage === "details" && (
            <>
              <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {payload && !crcFailed ? (
                    <Badge variant="secondary" className="w-fit gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Scanned successfully
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="w-fit gap-1.5">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Checksum mismatch
                    </Badge>
                  )}
                  {info?.merchantName && (
                    <p className="truncate text-sm font-medium">{info.merchantName}</p>
                  )}
                  {info && maskAccountTail(info) && (
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {maskAccountTail(info)}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto w-fit p-0 text-sm"
                    onClick={() => {
                      setAcknowledged(false);
                      setStage("scan");
                    }}
                  >
                    <ScanLine className="mr-1.5 h-3.5 w-3.5" />
                    Scan again
                  </Button>
                </div>
              </div>

              {needsAck && (
                <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="flex items-start gap-2 text-sm font-medium text-amber-700 dark:text-amber-500">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{ackMessage}</span>
                  </p>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={acknowledged}
                      onCheckedChange={(checked) => setAcknowledged(checked === true)}
                    />
                    Save anyway
                  </label>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="qr-name">Name</Label>
                <Input
                  id="qr-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={() => name.trim() && icons.length === 0 && void fetchIcons()}
                  placeholder="GCash — Ate Malou"
                  maxLength={60}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Icon</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!name.trim() || iconBusy}
                    onClick={() => void fetchIcons()}
                  >
                    {iconBusy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Find logo
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedIcon("initials")}
                    title="Use initials"
                    className={cn(
                      "h-14 w-14 overflow-hidden rounded-lg border-2 transition-colors",
                      selectedIcon === "initials" || selectedIcon === null
                        ? "border-primary"
                        : "border-transparent",
                    )}
                  >
                    <span
                      style={{ backgroundColor: fallbackBadge.color }}
                      className="flex h-full w-full items-center justify-center font-semibold text-white"
                    >
                      {fallbackBadge.initials}
                    </span>
                  </button>

                  {icons.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => setSelectedIcon(candidate.id)}
                      title={`Use the ${candidate.source} logo`}
                      className={cn(
                        "h-14 w-14 overflow-hidden rounded-lg border-2 bg-white p-1 transition-colors",
                        selectedIcon === candidate.id ? "border-primary" : "border-transparent",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:${candidate.contentType};base64,${candidate.bytesBase64}`}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {isEditing ? (
            <Button type="button" variant="ghost" onClick={() => void handleDelete()}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            {stage === "details" && (
              <Button type="button" onClick={() => void handleSave()} disabled={!canSave}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
      {ConfirmDialog}
    </Dialog>
  );
}
