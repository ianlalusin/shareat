"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Check, Loader2, Package, X } from "lucide-react";
import { ImageBoundary } from "@/components/shared/ImageBoundary";
import { KIND_LABEL, STATUS_LABEL, statusBadgeVariant } from "@/lib/product-requests/shared";
import { getDisplayName } from "@/lib/products/variants";
import type { ProductRequest } from "@/lib/types";

interface ReviewRequestDialogProps {
  request: ProductRequest | null;
  isOpen: boolean;
  onClose: () => void;
  /** Resolves once the decision has been applied (or rejected by the server). */
  onApprove: (request: ProductRequest, opts: { force: boolean; reviewNote: string | null }) => Promise<void>;
  onDecline: (request: ProductRequest, reviewNote: string) => Promise<void>;
  isSubmitting: boolean;
  /**
   * Set by the page when the approve op came back 409 with an existing catalog
   * match, so the admin can decide between overriding and declining.
   */
  duplicateWarning: string | null;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="text-sm">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

export function ReviewRequestDialog({
  request,
  isOpen,
  onClose,
  onApprove,
  onDecline,
  isSubmitting,
  duplicateWarning,
}: ReviewRequestDialogProps) {
  const [reviewNote, setReviewNote] = useState("");
  const [declineMode, setDeclineMode] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setReviewNote("");
      setDeclineMode(false);
    }
  }, [isOpen, request?.id]);

  if (!request) return null;

  const isPending = request.status === "pending";
  const noteTooShort = reviewNote.trim().length < 3;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90vh]">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="flex items-center gap-2">
            {getDisplayName(request)}
            <Badge variant={statusBadgeVariant(request.status)}>{STATUS_LABEL[request.status]}</Badge>
          </DialogTitle>
          <DialogDescription>
            Requested by {request.requestedByName} for {request.storeName}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-6 pb-4 space-y-4">
          <div className="flex items-start gap-4">
            <div className="w-28 h-28 shrink-0 rounded-md border flex items-center justify-center bg-muted/50 relative">
              <ImageBoundary>
                {request.imageUrl ? (
                  <Image
                    src={request.imageUrl}
                    alt={request.name}
                    fill
                    style={{ objectFit: "cover" }}
                    className="rounded-md"
                  />
                ) : (
                  <Package className="h-10 w-10 text-muted-foreground" />
                )}
              </ImageBoundary>
            </div>
            <div className="grid grid-cols-2 gap-3 flex-1">
              <Field label="Type" value={KIND_LABEL[request.requestKind]} />
              <Field label="Sub-category" value={request.subCategory} />
              <Field label="Unit of measure" value={request.uom} />
              <Field label="Barcode" value={request.barcode} />
            </div>
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Suggested price (this store only)"
              value={Number(request.suggestedPrice ?? 0).toFixed(2)}
            />
            <Field label="Cost" value={Number(request.cost ?? 0).toFixed(2)} />
            <Field label="Kitchen station" value={request.kitchenLocationName} />
            <Field label="Requesting store" value={request.storeName} />
          </div>

          {request.description && (
            <>
              <Separator />
              <Field label="Description" value={request.description} />
            </>
          )}

          {request.justification && (
            <>
              <Separator />
              <Field label="Why the store needs it" value={request.justification} />
            </>
          )}

          <p className="text-xs text-muted-foreground">
            Approving creates the product in the global catalog, adds it to {request.storeName} at{" "}
            {Number(request.suggestedPrice ?? 0).toFixed(2)}
            {request.requestKind === "addon" ? " with the add-on switch on" : ""}, and makes it
            importable by every other store at their own price.
          </p>

          {duplicateWarning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-700">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="text-xs">{duplicateWarning}</p>
            </div>
          )}

          {isPending && declineMode && (
            <div className="space-y-2">
              <Label htmlFor="review-note">Reason for declining</Label>
              <Textarea
                id="review-note"
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="The manager sees this — tell them why, and what to do instead."
              />
              {noteTooShort && (
                <p className="text-xs text-muted-foreground">
                  A reason is required so the manager knows why it was declined.
                </p>
              )}
            </div>
          )}

          {!isPending && request.reviewNote && (
            <>
              <Separator />
              <Field
                label={request.status === "rejected" ? "Decline reason" : "Reviewer note"}
                value={request.reviewNote}
              />
            </>
          )}
        </div>

        <DialogFooter className="p-6 pt-2">
          {isPending ? (
            declineMode ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDeclineMode(false)}
                  disabled={isSubmitting}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isSubmitting || noteTooShort}
                  onClick={() => onDecline(request, reviewNote.trim())}
                >
                  {isSubmitting ? <Loader2 className="animate-spin" /> : <X className="mr-2 h-4 w-4" />}
                  Decline Request
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeclineMode(true)}
                  disabled={isSubmitting}
                >
                  Decline…
                </Button>
                <Button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() =>
                    onApprove(request, {
                      force: !!duplicateWarning,
                      reviewNote: reviewNote.trim() || null,
                    })
                  }
                >
                  {isSubmitting ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  {duplicateWarning ? "Approve anyway" : "Approve"}
                </Button>
              </>
            )
          ) : (
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
