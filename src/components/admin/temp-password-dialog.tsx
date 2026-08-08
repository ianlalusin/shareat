"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Shows an admin-issued temporary password exactly once.
 *
 * It is never stored anywhere readable — the API hashes nothing and persists
 * nothing, Firebase Auth holds only its hash — so once this dialog closes the
 * value is unrecoverable and the only remedy is another reset.
 */

interface TempPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tempPassword: string | null;
  userName?: string | null;
  userEmail?: string | null;
}

export function TempPasswordDialog({
  isOpen,
  onClose,
  tempPassword,
  userName,
  userEmail,
}: TempPasswordDialogProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        variant: "destructive",
        title: "Copy Failed",
        description: "Select the password and copy it manually.",
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            For {userName || userEmail || "this user"}
            {userName && userEmail ? ` (${userEmail})` : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/50 p-4">
          <code className="block break-all text-center text-lg font-semibold tracking-wide select-all">
            {tempPassword}
          </code>
        </div>

        <Button variant="outline" onClick={handleCopy} className="w-full">
          {copied ? (
            <>
              <Check className="mr-2 h-4 w-4" /> Copied
            </>
          ) : (
            <>
              <Copy className="mr-2 h-4 w-4" /> Copy password
            </>
          )}
        </Button>

        <Alert variant="destructive">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Shown once</AlertTitle>
          <AlertDescription className="text-xs">
            Give it to the user now — it cannot be retrieved again. They will be
            required to set their own password the next time they sign in, and
            their existing sessions have been signed out.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button onClick={onClose} className="w-full">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
