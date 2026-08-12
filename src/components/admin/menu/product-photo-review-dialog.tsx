"use client";

import * as React from "react";
import { getAuth } from "firebase/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { ProductPhotoRequest } from "@/lib/types";
import Image from "next/image";
import { Loader2 } from "lucide-react";

interface ProductPhotoReviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  requests: ProductPhotoRequest[];
}

export function ProductPhotoReviewDialog({ isOpen, onClose, productName, requests }: ProductPhotoReviewDialogProps) {
  const { toast } = useToast();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const act = async (op: "promote" | "reject", requestId: string) => {
    setBusyId(requestId);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const idToken = await user.getIdToken();
      const res = await fetch("/api/product-photo-requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ op, requestId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || `Failed to ${op}.`);
      toast({ title: op === "promote" ? "Promoted to global" : "Rejected" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Action failed", description: err?.message || "Something went wrong." });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{productName} — pending store photos</DialogTitle>
          <DialogDescription>
            Promote a store's photo to be every store's default, or reject it. Rejecting an already-global photo
            resets every store relying on it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {requests.length === 0 && <p className="text-sm text-muted-foreground">No pending photos for this product.</p>}
          {requests.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="w-14 h-14 rounded-md bg-muted relative overflow-hidden shrink-0">
                <Image src={r.imageUrl} alt={r.storeName} fill style={{ objectFit: "cover" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.storeName}</p>
                <p className="text-xs text-muted-foreground truncate">by {r.submittedByName}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" disabled={busyId === r.id} onClick={() => act("promote", r.id)}>
                  {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Promote"}
                </Button>
                <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => act("reject", r.id)}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
