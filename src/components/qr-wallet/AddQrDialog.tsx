"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
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
import { QR_DECODE_MAX_EDGE, downscaleImage } from "@/lib/images/downscale";
import { decodeQrFromImage } from "@/lib/qr/decode-image";
import { guessProvider, maskAccountTail, parseEmvQr, type EmvQrInfo } from "@/lib/qr/emvco";
import { initialsBadge } from "@/lib/qr/initials";
import { cn } from "@/lib/utils";
import type { SavedQrCode } from "@/lib/types";

type IconCandidate = {
  id: string;
  source: string;
  contentType: string;
  bytesBase64: string;
};

type Stage = "capture" | "details";

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
 * FLOW ORDER IS DELIBERATE, and it is the one rule of this component:
 *
 *   capture → downscale → UPLOAD THE PHOTO → decode → parse → name → icon → save
 *
 * The photo is uploaded before anything that can fail. A blurry capture, an
 * unreadable QR, a dead icon service, a manager who wanders off mid-form — none
 * of those may cost us the photo, because a photo alone is still a usable
 * wallet entry (a customer can scan it off the screen).
 */
export function AddQrDialog({ open, onOpenChange, storeId, editing }: AddQrDialogProps) {
  const { toast } = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Id for this dialog session, fixed on open. Retaking the photo must reuse it
   * — minting a fresh one per capture would scatter orphaned objects across
   * Storage under ids no document ever references.
   */
  const draftIdRef = useRef<string>("");

  const [stage, setStage] = useState<Stage>("capture");
  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoSize, setPhotoSize] = useState<{ width: number; height: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [payload, setPayload] = useState<string | null>(null);
  const [info, setInfo] = useState<EmvQrInfo | null>(null);

  const [name, setName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const [icons, setIcons] = useState<IconCandidate[]>([]);
  const [iconBusy, setIconBusy] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);

  const isEditing = editing !== null;

  // Reset per-open so a second Add never inherits the first one's photo.
  useEffect(() => {
    if (!open) return;
    draftIdRef.current = editing?.id ?? crypto.randomUUID();
    if (editing) {
      setStage("details");
      setPhotoUrl(editing.photoUrl);
      setPhotoPath(editing.photoStoragePath);
      setPayload(editing.payload);
      setInfo(editing.payload ? parseEmvQr(editing.payload) : null);
      setName(editing.name);
    } else {
      setStage("capture");
      setPhotoUrl(null);
      setPhotoPath(null);
      setPayload(null);
      setInfo(null);
      setName("");
    }
    setPhotoSize(null);
    setPreviewUrl(null);
    setAcknowledged(false);
    setIcons([]);
    setSelectedIcon(null);
    setBusy(null);
    setSaving(false);
  }, [open, editing]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const warnings = info?.warnings ?? [];
  const hasAmount = warnings.includes("has_amount");
  const isDynamic = warnings.includes("dynamic_initiation");
  const needsAck = hasAmount || isDynamic;

  const provider = useMemo(() => guessProvider(info, name), [info, name]);
  const fallbackBadge = useMemo(() => initialsBadge(name || "QR"), [name]);

  /** Step 1–3: capture, upload, then decode. Upload before decode, always. */
  const handleFile = useCallback(
    async (file: File) => {
      const qrId = draftIdRef.current;
      try {
        setBusy("Preparing photo…");
        const shrunk = await downscaleImage(file, { maxEdge: QR_DECODE_MAX_EDGE });
        setPhotoSize({ width: shrunk.width, height: shrunk.height });
        setPreviewUrl(URL.createObjectURL(shrunk.blob));

        setBusy("Saving photo…");
        const path = `stores/${storeId}/qrWallet/${qrId}/photo-${Date.now()}.jpg`;
        const target = storageRef(storage, path);
        await uploadBytes(target, shrunk.blob, { contentType: "image/jpeg" });
        const url = await getDownloadURL(target);
        setPhotoUrl(url);
        setPhotoPath(path);

        setBusy("Reading QR code…");
        const decoded = await decodeQrFromImage(shrunk.blob);
        if (decoded) {
          const parsed = parseEmvQr(decoded.payload);
          setInfo(parsed);
          // A CRC-failing payload rendered as a fresh QR looks valid and fails
          // at the bank app — worse than useless. Treat it as not decoded.
          setPayload(parsed.crcValid ? parsed.raw : null);
          if (!parsed.crcValid) {
            toast({
              title: "QR checksum failed",
              description: "The saved photo will be shown instead of a re-rendered code.",
            });
          }
          if (!name && parsed.merchantName) setName(parsed.merchantName);
        } else {
          setInfo(null);
          setPayload(null);
          toast({
            title: "Couldn't read the QR",
            description: "The photo is saved — it will be shown as-is. Give it a name.",
          });
        }
        setStage("details");
      } catch (error: any) {
        console.error("[AddQrDialog] capture failed:", error);
        toast({
          variant: "destructive",
          title: "Couldn't save the photo",
          description: error?.message ?? "Please try again.",
        });
      } finally {
        setBusy(null);
      }
    },
    [editing?.id, name, storeId, toast],
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
    if (!trimmed || !photoUrl || !photoPath) return;

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
          iconUrl,
          iconStoragePath,
          iconSource,
          iconInitials: badge.initials,
          iconColor: badge.color,
          ...(payload !== editing.payload ? { payload, meta } : {}),
          ...(photoUrl !== editing.photoUrl
            ? { photoUrl, photoStoragePath: photoPath }
            : {}),
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
          decodeStatus: payload ? "decoded" : "failed",
          meta,
          photoUrl,
          photoStoragePath: photoPath,
          ...(photoSize ?? {}),
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
    photoPath,
    photoSize,
    photoUrl,
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

  const canSave =
    !!name.trim() && !!photoUrl && !saving && !busy && (!needsAck || acknowledged);

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && !busy && onOpenChange(next)}>
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit QR code" : "Add QR code"}</DialogTitle>
          <DialogDescription>
            {stage === "capture"
              ? "Take a photo of the QR code. The photo is saved either way."
              : "Name it and pick an icon."}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          // Hints the OS to open the rear camera. Where a WebView ignores it the
          // manager gets a file picker instead, which still works — that is why
          // this path needs no CAMERA permission and no APK rebuild.
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />

        <div className="space-y-4 py-1">
          {busy && (
            <div className="flex items-center justify-center gap-2 rounded-lg border bg-muted/40 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {busy}
            </div>
          )}

          {!busy && stage === "capture" && (
            <Button
              type="button"
              variant="outline"
              className="h-32 w-full flex-col gap-2 border-dashed"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="h-8 w-8 opacity-60" />
              <span className="font-medium">Take a photo of the QR</span>
            </Button>
          )}

          {!busy && stage === "details" && (
            <>
              <div className="flex items-start gap-3">
                <div className="shrink-0 overflow-hidden rounded-lg border bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl ?? photoUrl ?? ""}
                    alt="Captured QR"
                    className="h-24 w-24 object-contain"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {payload ? (
                    <Badge variant="secondary" className="w-fit gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      QR read successfully
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="w-fit gap-1.5">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      Saved as a photo
                    </Badge>
                  )}
                  {info?.merchantName && (
                    <p className="truncate text-sm text-muted-foreground">{info.merchantName}</p>
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
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Retake photo
                  </Button>
                </div>
              </div>

              {needsAck && (
                <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                  <p className="flex items-start gap-2 text-sm font-medium text-amber-700 dark:text-amber-500">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {hasAmount
                        ? `This QR has a fixed amount of ₱${info?.amount} baked in. Every customer would be charged that exact amount.`
                        : "This is a one-time QR and will stop working after it is used."}
                    </span>
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
              disabled={saving || !!busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={!canSave}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      {ConfirmDialog}
    </Dialog>
  );
}
