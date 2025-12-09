
"use client";

import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useFirestore } from "@/firebase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Timestamp, Firestore } from "firebase/firestore";
import { ApprovePendingAccountDialog } from "@/components/admin/approve-pending-account-dialog";
import { useToast } from "@/hooks/use-toast";

type PendingAccount = {
  id: string;
  uid: string;
  email: string;
  fullName: string;
  phone?: string;
  birthday?: string;
  notes?: string;
  status: "pending" | "approved" | "rejected";
  createdAt?: Timestamp;
};

type StaffDoc = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  birthday?: string;
  position?: string;
  assignedStoreId?: string;
  assignedStore?: string;
  employmentStatus: "Active" | "Inactive" | "Resigned" | "Probation" | string;
};

export default function PendingAccountsPage() {
  const firestore = useFirestore();
  const [pending, setPending] = useState<PendingAccount[]>([]);
  const [staff, setStaff] = useState<StaffDoc[]>([]);
  const [selected, setSelected] = useState<PendingAccount | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore) return;

    // Listen to pending accounts
    const q = query(
      collection(firestore, "pendingAccounts"),
      where("status", "==", "pending"),
      orderBy("createdAt", "desc")
    );

    const unsubPending = onSnapshot(q, (snap) => {
      const list: PendingAccount[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setPending(list);
    });

    // Listen to active staff (for attach flow)
    const staffQ = query(
      collection(firestore, "staff"),
      where("employmentStatus", "==", "Active")
    );

    const unsubStaff = onSnapshot(staffQ, (snap) => {
      const list: StaffDoc[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      setStaff(list);
    });

    return () => {
      unsubPending();
      unsubStaff();
    };
  }, [firestore]);

  const handleReject = async (pa: PendingAccount) => {
    if (!firestore) return;
    const confirm = window.confirm(
      `Reject access request from ${pa.fullName} (${pa.email})?`
    );
    if (!confirm) return;

    try {
      setRejectingId(pa.id);
      const ref = doc(firestore, "pendingAccounts", pa.id);
      await updateDoc(ref, {
        status: "rejected",
        rejectedAt: serverTimestamp(),
      });
      toast({
        title: "Request Rejected",
        description: `${pa.fullName}'s access request has been rejected.`,
      });
    } catch (err) {
      console.error("Error rejecting pending account", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to reject request. Please try again.",
      });
    } finally {
      setRejectingId(null);
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Pending Account Requests
        </h1>
        <span className="text-xs text-muted-foreground">
          {pending.length} pending
        </span>
      </div>

      <Card className="border shadow-sm bg-background">
        {pending.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            No pending account requests.
          </div>
        ) : (
          <ScrollArea className="w-full max-w-full">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((pa) => (
                  <TableRow key={pa.id}>
                    <TableCell className="font-medium">
                      {pa.fullName}
                    </TableCell>
                    <TableCell>{pa.email}</TableCell>
                    <TableCell>{pa.phone || "—"}</TableCell>
                    <TableCell>
                      {pa.createdAt
                        ? pa.createdAt.toDate().toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {pa.notes || "—"}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelected(pa)}
                      >
                        Review
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={rejectingId === pa.id}
                        onClick={() => handleReject(pa)}
                      >
                        {rejectingId === pa.id ? "Rejecting..." : "Reject"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </Card>

      {/* Approve / Attach dialog */}
      {selected && firestore && (
        <ApprovePendingAccountDialog
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          pending={selected}
          staffList={staff}
          firestore={firestore}
        />
      )}
    </main>
  );
}
