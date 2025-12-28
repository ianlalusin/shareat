

"use client";

import { useState, useEffect, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase/client";
import { doc, updateDoc, serverTimestamp, getDoc } from "firebase/firestore";
import { useAuthContext } from "@/context/auth-context";
import { type PendingSession } from "./pending-tables";
import type { StorePackage } from "../manager/store-settings/store-packages-settings";
import { MenuSchedule } from "../manager/store-settings/schedules-settings";
import { isScheduleActiveNow } from "../manager/store-settings/utils/isScheduleActiveNow";
import { useIsMobile } from "@/hooks/use-mobile";

const REASON_OPTIONS = {
  guest_request: "Guest Request",
  guest_left: "Guest Left",
  additional_guest_arrived: "Additional Guest Arrived",
  item_unavailable: "Item Unavailable",
  other: "Other",
};
type ReasonKey = keyof typeof REASON_OPTIONS;

const baseSchema = z.object({
  reason: z.string({ required_error: "A reason is required." }),
  reasonNote: z.string().optional(),
});

const guestCountSchema = baseSchema.extend({
  requestedCount: z.coerce.number().min(0, "Guest count must be 0 or more."),
}).refine(data => !(data.reason === 'other' && (!data.reasonNote || data.reasonNote.trim() === '')), {
    message: "Details are required when reason is 'Other'.",
    path: ["reasonNote"],
});

const packageSchema = baseSchema.extend({
  requestedPackageId: z.string({ required_error: "Please select a package." }),
}).refine(data => !(data.reason === 'other' && (!data.reasonNote || data.reasonNote.trim() === '')), {
    message: "Details are required when reason is 'Other'.",
    path: ["reasonNote"],
});


interface RequestChangeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  session: PendingSession;
  storeId: string;
  storePackages: StorePackage[];
  schedules: Map<string, MenuSchedule>;
}

const DIALOG_TABS = [
    { value: "guest", label: "Guest Count" },
    { value: "package", label: "Package" },
]

export function RequestChangeDialog({ isOpen, onClose, session, storeId, storePackages, schedules }: RequestChangeDialogProps) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState("guest");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const guestForm = useForm<z.infer<typeof guestCountSchema>>({
    resolver: zodResolver(guestCountSchema),
    defaultValues: { requestedCount: session.guestCountFinal || 0, reasonNote: "" },
  });

  const packageForm = useForm<z.infer<typeof packageSchema>>({
    resolver: zodResolver(packageSchema),
    defaultValues: { requestedPackageId: session.packageOfferingId, reasonNote: "" },
  });

  const watchedGuestReason = guestForm.watch("reason");
  const watchedPackageReason = packageForm.watch("reason");

  const availablePackages = useMemo(() => {
    return storePackages.filter(pkg => {
        if (!pkg.isEnabled) return false;
        if (!pkg.menuScheduleId) return true;
        const schedule = schedules.get(pkg.menuScheduleId);
        if (!schedule) return true; // Fail open if schedule not found
        return isScheduleActiveNow(schedule);
    });
  }, [storePackages, schedules]);


  useEffect(() => {
    if (isOpen) {
      guestForm.reset({ requestedCount: session.guestCountFinal || 0, reasonNote: "" });
      packageForm.reset({ requestedPackageId: session.packageOfferingId, reasonNote: "" });
    }
  }, [isOpen, session, guestForm, packageForm]);
  
  const checkSessionLock = async () => {
    const sessionRef = doc(db, "stores", storeId, "sessions", session.id);
    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists() || sessionSnap.data().status === 'closed' || sessionSnap.data().isPaid) {
        toast({ variant: 'destructive', title: 'Action Failed', description: 'This session has already been closed.' });
        onClose();
        return true;
    }
    return false;
  }

  const handleGuestSubmit = async (data: z.infer<typeof guestCountSchema>) => {
    if (!appUser || await checkSessionLock()) return;
    setIsSubmitting(true);
    const sessionRef = doc(db, "stores", storeId, "sessions", session.id);
    try {
      await updateDoc(sessionRef, {
        "guestCountChange.status": "pending",
        "guestCountChange.requestedCount": data.requestedCount,
        "guestCountChange.reason": data.reason,
        "guestCountChange.reasonNote": data.reason === 'other' ? data.reasonNote?.trim() : (data.reasonNote?.trim() || null),
        "guestCountChange.requestedByUid": appUser.uid,
        "guestCountChange.requestedAt": serverTimestamp(),
      });
      toast({ title: "Request Sent", description: "Guest count change request sent to cashier for approval." });
      onClose();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Request Failed", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePackageSubmit = async (data: z.infer<typeof packageSchema>) => {
    if (!appUser || await checkSessionLock()) return;
    const selectedPackage = availablePackages.find(p => p.packageId === data.requestedPackageId);
    if (!selectedPackage) {
      toast({ variant: "destructive", title: "Invalid Package" });
      return;
    }
    setIsSubmitting(true);
    const sessionRef = doc(db, "stores", storeId, "sessions", session.id);
    try {
      await updateDoc(sessionRef, {
        "packageChange.status": "pending",
        "packageChange.requestedPackageId": data.requestedPackageId,
        "packageChange.requestedPackageSnapshot": {
          name: selectedPackage.packageName,
          pricePerHead: selectedPackage.pricePerHead,
        },
        "packageChange.reason": data.reason,
        "packageChange.reasonNote": data.reason === 'other' ? data.reasonNote?.trim() : (data.reasonNote?.trim() || null),
        "packageChange.requestedByUid": appUser.uid,
        "packageChange.requestedAt": serverTimestamp(),
      });
      toast({ title: "Request Sent", description: "Package change request sent to cashier for approval." });
      onClose();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Request Failed", description: e.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const isGuestRequestPending = session.guestCountChange?.status === "pending";
  const isPackageRequestPending = session.packageChange?.status === "pending";
  const isSessionLocked = session.status === "closed";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Change for Table {session.tableNumber}</DialogTitle>
          <DialogDescription>Submit a request for a cashier to approve.</DialogDescription>
        </DialogHeader>
        {isSessionLocked && (
            <Alert variant="destructive">
                <AlertDescription>This session is closed and cannot be modified.</AlertDescription>
            </Alert>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {isMobile ? (
             <Select value={activeTab} onValueChange={setActiveTab}>
                <SelectTrigger>
                    <SelectValue placeholder="Select a change type..." />
                </SelectTrigger>
                <SelectContent>
                    {DIALOG_TABS.map(tab => (
                        <SelectItem key={tab.value} value={tab.value}>{tab.label}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
          ) : (
            <TabsList className="grid w-full grid-cols-2">
                {DIALOG_TABS.map(tab => (
                    <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
                ))}
            </TabsList>
          )}

          <TabsContent value="guest">
            <form onSubmit={guestForm.handleSubmit(handleGuestSubmit)} className="space-y-4 pt-4">
              {isGuestRequestPending && (
                <Alert variant="destructive">
                  <AlertDescription>A guest count change request is already pending for this session.</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="requestedCount">New Guest Count</Label>
                <Input id="requestedCount" type="number" {...guestForm.register("requestedCount")} />
                {guestForm.formState.errors.requestedCount && <p className="text-sm text-destructive">{guestForm.formState.errors.requestedCount.message}</p>}
              </div>
               <div className="space-y-2">
                <Label>Reason</Label>
                <Controller
                  name="reason"
                  control={guestForm.control}
                  render={({ field, fieldState }) => (
                    <>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger><SelectValue placeholder="Select a reason..." /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(REASON_OPTIONS).map(([key, value]) => (
                            <SelectItem key={key} value={key}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fieldState.error && <p className="text-sm text-destructive">{fieldState.error.message}</p>}
                    </>
                  )}
                />
              </div>
              {watchedGuestReason === 'other' && (
                <div className="space-y-2">
                    <Label htmlFor="guestNote">Details for "Other"</Label>
                    <Textarea id="guestNote" {...guestForm.register("reasonNote")} />
                    {guestForm.formState.errors.reasonNote && <p className="text-sm text-destructive">{guestForm.formState.errors.reasonNote.message}</p>}
                </div>
              )}
              <Button type="submit" disabled={isSubmitting || isGuestRequestPending || isSessionLocked} className="w-full">
                {isSubmitting ? <Loader2 className="animate-spin" /> : "Request Guest Count Change"}
              </Button>
            </form>
          </TabsContent>
          <TabsContent value="package">
             <form onSubmit={packageForm.handleSubmit(handlePackageSubmit)} className="space-y-4 pt-4">
              {isPackageRequestPending && (
                <Alert variant="destructive">
                  <AlertDescription>A package change request is already pending for this session.</AlertDescription>
                </Alert>
              )}
               <div className="space-y-2">
                <Label>New Package</Label>
                <Controller
                  name="requestedPackageId"
                  control={packageForm.control}
                  render={({ field }) => (
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger><SelectValue placeholder="Select a package..." /></SelectTrigger>
                      <SelectContent>
                        {availablePackages.length > 0 ? (
                            availablePackages.map(p => (
                            <SelectItem key={p.packageId} value={p.packageId}>
                                {p.packageName} - ₱{p.pricePerHead}/head
                            </SelectItem>
                            ))
                        ) : (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                                No packages available at this time.
                            </div>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                />
                 {packageForm.formState.errors.requestedPackageId && <p className="text-sm text-destructive">{packageForm.formState.errors.requestedPackageId.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Reason</Label>
                <Controller
                  name="reason"
                  control={packageForm.control}
                  render={({ field, fieldState }) => (
                    <>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger><SelectValue placeholder="Select a reason..." /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(REASON_OPTIONS).map(([key, value]) => (
                            <SelectItem key={key} value={key}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fieldState.error && <p className="text-sm text-destructive">{fieldState.error.message}</p>}
                    </>
                  )}
                />
              </div>
              {watchedPackageReason === 'other' && (
                <div className="space-y-2">
                    <Label htmlFor="packageNote">Details for "Other"</Label>
                    <Textarea id="packageNote" {...packageForm.register("reasonNote")} />
                    {packageForm.formState.errors.reasonNote && <p className="text-sm text-destructive">{packageForm.formState.errors.reasonNote.message}</p>}
                </div>
              )}
              <Button type="submit" disabled={isSubmitting || isPackageRequestPending || isSessionLocked || availablePackages.length === 0} className="w-full">
                {isSubmitting ? <Loader2 className="animate-spin" /> : "Request Package Change"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
