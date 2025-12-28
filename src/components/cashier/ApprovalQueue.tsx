

"use client";

import { useState, useEffect } from "react";
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, writeBatch, getDocs, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Check, X, Package, Users } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { logActivity } from "@/lib/firebase/activity-log";
import { useConfirmDialog } from "@/components/global/confirm-dialog";

type ChangeRequest = {
  sessionId: string;
  tableNumber: string;
  type: 'guest' | 'package';
  requestedAt: any;
  requestedBy: string;
  details: string;
  currentValue: string | number;
  requestedValue: string | number;
  reason: string;
  reasonNote?: string;
  isSessionLocked: boolean;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
};

export function ApprovalQueue({ storeId }: { storeId: string }) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const sessionsRef = collection(db, "stores", storeId, "sessions");
    const q = query(sessionsRef, where("status", "==", "active"));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const userIds = new Set<string>();
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.guestCountChange?.requestedByUid) userIds.add(data.guestCountChange.requestedByUid);
        if (data.packageChange?.requestedByUid) userIds.add(data.packageChange.requestedByUid);
      });

      let userProfiles: Record<string, string> = {};
      if (userIds.size > 0) {
        const usersQuery = query(collection(db, "users"), where("id", "in", Array.from(userIds)));
        const userSnap = await getDocs(usersQuery);
        userSnap.forEach(doc => userProfiles[doc.id] = doc.data().name || "Unknown");
      }

      const pendingRequests: ChangeRequest[] = [];
      snapshot.forEach(sessionDoc => {
        const session = sessionDoc.data();
        const isLocked = session.status === 'closed' || session.isPaid === true;
        
        // Guest Count Change Request
        if (session.guestCountChange?.status === 'pending') {
          pendingRequests.push({
            sessionId: sessionDoc.id,
            tableNumber: session.tableNumber,
            type: 'guest',
            requestedAt: session.guestCountChange.requestedAt?.toDate(),
            requestedBy: userProfiles[session.guestCountChange.requestedByUid] || '...',
            details: `Change guest count`,
            currentValue: session.guestCountFinal,
            requestedValue: session.guestCountChange.requestedCount,
            reason: session.guestCountChange.reason,
            reasonNote: session.guestCountChange.reasonNote,
            isSessionLocked: isLocked,
            onApprove: async () => {
              const sessionRef = doc(db, "stores", storeId, "sessions", sessionDoc.id);
              await updateDoc(sessionRef, {
                guestCountFinal: session.guestCountChange.requestedCount,
                "guestCountChange.status": "approved",
                "guestCountChange.approvedByUid": appUser?.uid,
                "guestCountChange.approvedAt": serverTimestamp(),
              });
              await logActivity(appUser!, "guest_count_approved", `Approved guest count change for session ${sessionDoc.id}`);
            },
            onReject: async () => {
              const sessionRef = doc(db, "stores", storeId, "sessions", sessionDoc.id);
              await updateDoc(sessionRef, {
                "guestCountChange.status": "rejected",
                "guestCountChange.rejectedByUid": appUser?.uid,
                "guestCountChange.rejectedAt": serverTimestamp(),
              });
               await logActivity(appUser!, "guest_count_rejected", `Rejected guest count change for session ${sessionDoc.id}`);
            },
          });
        }
        
        // Package Change Request
        if (session.packageChange?.status === 'pending') {
           pendingRequests.push({
            sessionId: sessionDoc.id,
            tableNumber: session.tableNumber,
            type: 'package',
            requestedAt: session.packageChange.requestedAt?.toDate(),
            requestedBy: userProfiles[session.packageChange.requestedByUid] || '...',
            details: `Change package`,
            currentValue: session.packageSnapshot.name,
            requestedValue: session.packageChange.requestedPackageSnapshot.name,
            reason: session.packageChange.reason,
            reasonNote: session.packageChange.reasonNote,
            isSessionLocked: isLocked,
            onApprove: async () => {
                const sessionRef = doc(db, "stores", storeId, "sessions", sessionDoc.id);
                const batch = writeBatch(db);

                // Update session
                batch.update(sessionRef, {
                    packageOfferingId: session.packageChange.requestedPackageId,
                    packageSnapshot: session.packageChange.requestedPackageSnapshot,
                    "packageChange.status": "approved",
                    "packageChange.approvedByUid": appUser?.uid,
                    "packageChange.approvedAt": serverTimestamp(),
                });

                // Find the existing package billable item and update it
                const billablesRef = collection(db, "stores", storeId, "sessions", sessionDoc.id, "billables");
                const qBillables = query(billablesRef, where("type", "==", "package"));
                const billableSnap = await getDocs(qBillables);

                billableSnap.forEach(billableDoc => {
                    batch.update(billableDoc.ref, {
                        itemName: session.packageChange.requestedPackageSnapshot.name,
                        unitPrice: session.packageChange.requestedPackageSnapshot.pricePerHead,
                    });
                });

                await batch.commit();
                await logActivity(appUser!, "package_change_approved", `Approved package change for session ${sessionDoc.id}`);
            },
            onReject: async () => {
              const sessionRef = doc(db, "stores", storeId, "sessions", sessionDoc.id);
              await updateDoc(sessionRef, {
                "packageChange.status": "rejected",
                "packageChange.rejectedByUid": appUser?.uid,
                "packageChange.rejectedAt": serverTimestamp(),
              });
              await logActivity(appUser!, "package_change_rejected", `Rejected package change for session ${sessionDoc.id}`);
            },
          });
        }
      });
      setRequests(pendingRequests.sort((a,b) => b.requestedAt - a.requestedAt));
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [storeId, appUser]);

  const handleApprove = async (req: ChangeRequest) => {
    if (req.isSessionLocked) {
      toast({ variant: 'destructive', title: 'Action Failed', description: 'This session is already closed and cannot be modified.' });
      return;
    }
    if (!(await confirm({ title: `Approve this ${req.type} change?`, confirmText: "Yes, Approve", destructive: false }))) return;
    try {
      await req.onApprove();
      toast({ title: "Request Approved" });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Approval Failed", description: e.message });
    }
  };

  const handleReject = async (req: ChangeRequest) => {
     if (req.isSessionLocked) {
      toast({ variant: 'destructive', title: 'Action Failed', description: 'This session is already closed and cannot be modified.' });
      return;
    }
    if (!(await confirm({ title: `Reject this ${req.type} change?`, confirmText: "Yes, Reject", destructive: true }))) return;
    try {
      await req.onReject();
      toast({ title: "Request Rejected" });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Rejection Failed", description: e.message });
    }
  };

  if (isLoading || requests.length === 0) {
    return null; // Don't show anything if no requests or still loading
  }

  return (
    <>
      <Accordion type="single" collapsible defaultValue="item-1" className="w-full">
        <AccordionItem value="item-1">
          <Card>
            <CardHeader className="p-0">
                <AccordionTrigger className="p-6">
                    <div className="flex items-center gap-4">
                        <div>
                            <CardTitle>Approval Queue</CardTitle>
                            <CardDescription>Review pending requests from servers.</CardDescription>
                        </div>
                         <Badge variant="destructive">{requests.length}</Badge>
                    </div>
                </AccordionTrigger>
            </CardHeader>
            <AccordionContent>
                <CardContent className="space-y-4 pt-4">
                {requests.map((req) => (
                    <Card key={req.sessionId + req.type} className="p-4">
                        <div className="flex justify-between items-start">
                            <div>
                                <h4 className="font-semibold">Table {req.tableNumber}</h4>
                                <p className="text-sm text-muted-foreground">
                                    {req.details} - Requested by {req.requestedBy}
                                </p>
                            </div>
                             <div className="flex items-center gap-2">
                                <p className="text-xs text-muted-foreground whitespace-nowrap pl-4">
                                    {req.requestedAt ? formatDistanceToNow(req.requestedAt, { addSuffix: true }) : 'just now'}
                                </p>
                                {req.isSessionLocked && <Badge variant="outline">Closed</Badge>}
                            </div>
                        </div>
                        <div className="flex items-center gap-4 my-2 p-2 bg-muted rounded-md">
                            <div className="flex-1 text-center">
                                <p className="text-xs text-muted-foreground">Current</p>
                                <p className="font-bold">{req.currentValue}</p>
                            </div>
                            <ArrowRight className="text-muted-foreground"/>
                             <div className="flex-1 text-center text-destructive">
                                <p className="text-xs">Requested</p>
                                <p className="font-bold">{req.requestedValue}</p>
                            </div>
                        </div>
                         <p className="text-xs text-muted-foreground italic">Reason: {req.reasonNote || req.reason}</p>
                        <div className="flex justify-end gap-2 mt-2">
                            <Button variant="destructive" size="sm" onClick={() => handleReject(req)} disabled={req.isSessionLocked}><X className="mr-2"/> Reject</Button>
                            <Button size="sm" onClick={() => handleApprove(req)} disabled={req.isSessionLocked}><Check className="mr-2"/> Approve</Button>
                        </div>
                    </Card>
                ))}
                </CardContent>
            </AccordionContent>
          </Card>
        </AccordionItem>
      </Accordion>
      {Dialog}
    </>
  );
}
