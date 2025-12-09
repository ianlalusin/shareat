
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
import { useFirestore, useAuth } from "@/firebase";
import { Card, CardContent } from "@/components/ui/card";
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
import { PendingAccount, Staff, User } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User as UserIcon } from 'lucide-react';
import { useAuthContext } from "@/context/auth-context";

type StaffDoc = Staff & { id: string };

export default function PendingAccountsPage() {
  const firestore = useFirestore();
  const auth = useAuth();
  const { user } = useAuthContext();
  const [newAccounts, setNewAccounts] = useState<PendingAccount[]>([]);
  const [profileUpdates, setProfileUpdates] = useState<PendingAccount[]>([]);
  const [staff, setStaff] = useState<StaffDoc[]>([]);
  const [selected, setSelected] = useState<PendingAccount | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore) return;

    const newAccountsQuery = query(
      collection(firestore, "pendingAccounts"),
      where("status", "==", "pending"),
      where("type", "==", "new_account"),
      orderBy("createdAt", "desc")
    );
    const unsubNew = onSnapshot(newAccountsQuery, (snap) => {
      setNewAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PendingAccount)));
    });

    const updatesQuery = query(
      collection(firestore, "pendingAccounts"),
      where("status", "==", "pending"),
      where("type", "==", "profile_update"),
      orderBy("createdAt", "desc")
    );
    const unsubUpdates = onSnapshot(updatesQuery, (snap) => {
      setProfileUpdates(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PendingAccount)));
    });
    
    const staffQ = query(
      collection(firestore, "staff"),
      where("employmentStatus", "==", "Active")
    );
    const unsubStaff = onSnapshot(staffQ, (snap) => {
      setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffDoc)));
    });

    return () => {
      unsubNew();
      unsubUpdates();
      unsubStaff();
    };
  }, [firestore]);

  const handleReject = async (pa: PendingAccount) => {
    if (!firestore || !user) return;
    const confirm = window.confirm(
      `Reject this request from ${pa.fullName} (${pa.email})?`
    );
    if (!confirm) return;

    try {
      setRejectingId(pa.id);
      const ref = doc(firestore, "pendingAccounts", pa.id);
      await updateDoc(ref, {
        status: "rejected",
        rejectedAt: serverTimestamp(),
        rejectedBy: user.displayName || user.email,
      });
      toast({
        title: "Request Rejected",
        description: `${pa.fullName}'s request has been rejected.`,
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
          Pending Requests
        </h1>
      </div>

      <Tabs defaultValue="new-accounts">
        <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="new-accounts">New Accounts ({newAccounts.length})</TabsTrigger>
            <TabsTrigger value="profile-updates">Profile Updates ({profileUpdates.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="new-accounts">
            <Card className="border shadow-sm bg-background mt-4">
                <CardContent className="p-0">
                    {newAccounts.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
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
                            <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {newAccounts.map((pa) => (
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
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="profile-updates">
             <Card className="border shadow-sm bg-background mt-4">
                <CardContent className="p-0">
                    {profileUpdates.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        No pending profile updates.
                    </div>
                    ) : (
                    <ScrollArea className="w-full max-w-full">
                        <Table>
                        <TableHeader>
                            <TableRow>
                            <TableHead>Staff Name</TableHead>
                            <TableHead>Requested</TableHead>
                            <TableHead>Fields Changed</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {profileUpdates.map((pa) => (
                            <TableRow key={pa.id}>
                                <TableCell className="font-medium">
                                     <div className="flex items-center gap-3">
                                        <Avatar className="h-9 w-9">
                                        <AvatarImage src={pa.picture} alt={pa.fullName} />
                                        <AvatarFallback>
                                            <UserIcon />
                                        </AvatarFallback>
                                        </Avatar>
                                        <div>
                                            <div className="font-medium">{pa.fullName}</div>
                                            <div className="text-sm text-muted-foreground">{pa.email}</div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                {pa.createdAt
                                    ? pa.createdAt.toDate().toLocaleString()
                                    : "—"}
                                </TableCell>
                                <TableCell>
                                  {Object.keys(pa.updates || {}).join(', ')}
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
                </CardContent>
            </Card>
        </TabsContent>
      </Tabs>
      
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
