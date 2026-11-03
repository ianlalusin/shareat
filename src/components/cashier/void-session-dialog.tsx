
"use client";

import { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { voidSession } from "./firestore";
import { voidSessionOffline } from "./offlineVoid";
import { useOnlineStatus } from "@/hooks/use-online-status";
import type { ActiveSession } from "./active-sessions-grid";
import type { AppUser } from "@/context/auth-context";

interface VoidSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  session: ActiveSession;
  user: AppUser;
  storeId: string;
}

export function VoidSessionDialog({ isOpen, onClose, session, user, storeId }: VoidSessionDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isOnline = useOnlineStatus();

  const isLocked = session.isPaid;
  // Stable per dialog: a retry after a timeout replays the same server command.
  const opIdRef = useRef<string>(uuidv4());

  const handleConfirm = async () => {
    const safeReason = (reason ?? '').toString().trim();
    if (!safeReason) {
      toast({ variant: 'destructive', title: 'Reason Required', description: 'Please provide a reason for voiding the session.' });
      return;
    }
    setIsSubmitting(true);
    try {
      if (isOnline) {
        // Server command (audit P1): the void, table release and the PIN /
        // loyalty reversals (server outbox) all happen server-side.
        await voidSession({ storeId, sessionId: session.id, reason: safeReason, actor: user, opId: opIdRef.current });
        toast({ title: "Session Voided", description: "The session has been cancelled and the table is now free." });
        onClose();
      } else {
        // Offline: the queue item + create-only command are saved BEFORE the
        // void is reported (audit B17); the server applies it on reconnect.
        const { queued } = await voidSessionOffline({ storeId, sessionId: session.id, reason: safeReason, actor: user });
        toast({
          title: queued ? "Void recorded (pending sync)" : "Session already closed",
          description: queued
            ? "The void will be applied when this till is back online. The table frees once the server confirms."
            : "This session was already closed or voided.",
        });
        onClose();
      }
    } catch (error: any) {
      console.error("Failed to void session:", error);
      toast({ variant: 'destructive', title: 'Action Failed', description: error.message || String(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void Session: Table {session.tableNumber}</DialogTitle>
          <DialogDescription>This action cannot be undone. All items will be cancelled and the table will be freed.</DialogDescription>
        </DialogHeader>
        {isLocked ? (
          <Alert variant="destructive">
            <AlertDescription>This session is already paid or closed and cannot be voided.</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2 py-4">
            <Label htmlFor="void-reason">Reason</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Customer complaint, wrong order"
            />
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isSubmitting || isLocked || !reason.trim()}
          >
            {isSubmitting && <Loader2 className="mr-2 animate-spin" />}
            Confirm Void
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
