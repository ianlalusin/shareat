"use client";

import { useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { writeActivityLog } from "@/components/cashier/activity-log";
import { computeSessionLabel } from "@/lib/utils/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SessionAuditFlag } from "@/lib/session-timeline/types";
import type { SessionDoc } from "@/lib/types";

/**
 * Flag a session for manager review, or clear an existing flag.
 *
 * Writes `stores/{storeId}/sessionAuditFlags/{sessionId}` plus an activity log,
 * exactly as the session-audit page did. The manager-only restriction here is
 * presentational — Firestore rules allow any store-scoped staff to write this
 * document, so treat it as a workflow control, not a security boundary.
 */
export function ManagerReviewControl({
  storeId,
  sessionId,
  session,
  flag,
  onSaved,
}: {
  storeId: string;
  sessionId: string;
  session: SessionDoc | null;
  flag: SessionAuditFlag | null;
  onSaved?: (next: SessionAuditFlag) => void;
}) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const [severity, setSeverity] = useState<SessionAuditFlag["severity"]>(flag?.severity ?? "medium");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage =
    appUser?.isPlatformAdmin === true || appUser?.role === "admin" || appUser?.role === "manager";
  const isFlagged = flag?.status === "flagged";

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        Only managers and admins can flag or clear session reviews.
      </p>
    );
  }

  const save = async (status: "flagged" | "cleared") => {
    if (!appUser || saving) return; // guard the double-tap
    setSaving(true);
    try {
      const actorName = appUser.displayName || appUser.name || appUser.email || null;
      const patch: SessionAuditFlag = {
        sessionId,
        storeId,
        status,
        severity,
        reason: status === "flagged" ? reason.trim() || null : flag?.reason ?? null,
        notes: status === "flagged" ? reason.trim() || null : flag?.notes ?? null,
        flaggedByUid: status === "flagged" ? appUser.uid : flag?.flaggedByUid ?? null,
        flaggedByName: status === "flagged" ? actorName : flag?.flaggedByName ?? null,
        flaggedAt: status === "flagged" ? serverTimestamp() : flag?.flaggedAt ?? null,
        clearedByUid: status === "cleared" ? appUser.uid : null,
        clearedByName: status === "cleared" ? actorName : null,
        clearedAt: status === "cleared" ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, "stores", storeId, "sessionAuditFlags", sessionId), patch, { merge: true });

      const anySession = session as any;
      await writeActivityLog({
        storeId,
        sessionId,
        user: appUser,
        action: status === "flagged" ? "SESSION_AUDIT_FLAGGED" : "SESSION_AUDIT_CLEARED",
        reason: status === "flagged" ? reason.trim() || "Flagged for review" : "Audit flag cleared",
        sessionContext: {
          sessionStatus: anySession?.status,
          sessionStartedAt: anySession?.startedAt,
          sessionMode: anySession?.sessionMode,
          customerName: anySession?.customerName ?? anySession?.customer?.name,
          tableNumber: anySession?.tableNumber,
          tableDisplayName: anySession?.tableDisplayName,
        },
        meta: {
          severity,
          sessionLabel: session ? computeSessionLabel(session as any) : sessionId.slice(0, 8),
        } as any,
      });

      if (status === "cleared") setReason("");
      onSaved?.(patch);
      toast({ title: status === "flagged" ? "Session flagged" : "Flag cleared" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Could not save", description: err?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {isFlagged ? (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" aria-hidden /> Flagged
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle className="h-3 w-3" aria-hidden /> Not flagged
          </Badge>
        )}
        {flag?.flaggedByName && isFlagged && (
          <span className="text-xs text-muted-foreground">by {flag.flaggedByName}</span>
        )}
      </div>

      {isFlagged && flag?.reason && (
        <p className="text-sm rounded-md bg-muted p-2 text-muted-foreground">{flag.reason}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-[160px_1fr] sm:items-start">
        <div className="space-y-1.5">
          <Label htmlFor={`severity-${sessionId}`}>Severity</Label>
          <Select value={severity} onValueChange={(v) => setSeverity(v as SessionAuditFlag["severity"])}>
            <SelectTrigger id={`severity-${sessionId}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`reason-${sessionId}`}>Reason</Label>
          <Textarea
            id={`reason-${sessionId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What needs a second look?"
            rows={2}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={saving} onClick={() => save("flagged")}>
          {saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
          Flag for review
        </Button>
        <Button size="sm" variant="outline" disabled={saving || !isFlagged} onClick={() => save("cleared")}>
          Clear flag
        </Button>
      </div>
    </div>
  );
}
