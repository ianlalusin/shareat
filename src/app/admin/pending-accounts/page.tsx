

"use client";

import { useEffect, useState, useMemo } from "react";
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
import { PendingAccount, Staff, User, Store } from "@/lib/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User as UserIcon } from 'lucide-react';
import { useAuthContext } from "@/context/auth-context";
import { isAdmin } from "@/lib/scope";

type StaffDoc = Staff & { id: string };

export default function PendingAccountsPage() {
  const firestore = useFirestore();
  const { user, appUser } = useAuthContext();
  const [allPending, setAllPending] = useState<PendingAccount[]>([]);
  const [staff, setStaff] = useState<StaffDoc[]>([]);
  const [selected, setSelected] = useState<PendingAccount | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore) return;

    const pendingAccountsQuery = query(
      collection(firestore, "pendingAccounts"),
      where("status", "==", "pending"),
      orderBy("createdAt", "desc")
    );
    const unsubPending = onSnapshot(pendingAccountsQuery, (snap) => {
      setAllPending(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PendingAccount)));
    });

    const staffQuery = query(collection(firestore, "staff"));
    const unsubStaff = onSnapshot(staffQuery, (snap) => {
      setStaff(snap.docs.map((d) => ({ id: d.id, ...d.data() } as StaffDoc)));
    });

    return () => {
      unsubPending();
      unsubStaff();
    };
  }, [firestore]);
  
  const filteredPending = useMemo(() => {
    if (isAdmin(appUser)) {
      return allPending;
    }
    if (appUser?.role === 'manager' && appUser.storeIds) {
      const managerStoreIds = new Set(appUser.storeIds);
      const staffInManagedStores = staff
        .filter(s => s.storeIds?.some(id => managerStoreIds.has(id)))
        .map(s => s.id);
      
      const staffIdSet = new Set(staffInManagedStores);
      
      return allPending.filter(p => p.type === 'profile_update' && p.staffId && staffIdSet.has(p.staffId));
    }
    return [];
  }, [allPending, staff, appUser]);

  const newAccounts = useMemo(() => filteredPending.filter(p => p.type === 'new_account'), [filteredPending]);
  const profileUpdates = useMemo(() => filteredPending.filter(p => p.type === 'profile_update'), [filteredPending]);

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

  const renderTable = (data: PendingAccount[], isUpdate: boolean) => (
     <Table>
        <TableHeader>
            <TableRow>
            <TableHead>Staff Name</TableHead>
            <TableHead className="hidden sm:table-cell">Requested</TableHead>
            {isUpdate ? <TableHead>Fields Changed</TableHead> : <TableHead className="hidden md:table-cell">Phone</TableHead>}
            <TableHead className="text-right">Actions</TableHead>
            </TableRow>
        </TableHeader>
        <TableBody>
            {data.map((pa) => (
            <TableRow key={pa.id}>
                <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                        {isUpdate && <Avatar className="h-9 w-9 hidden sm:flex">
                        <AvatarImage src={pa.picture} alt={pa.fullName} />
                        <AvatarFallback><UserIcon /></AvatarFallback>
                        </Avatar>}
                        <div>
                            <div>{pa.fullName}</div>
                            <div className="text-sm text-muted-foreground sm:hidden">{pa.createdAt ? pa.createdAt.toDate().toLocaleDateString() : '—'}</div>
                        </div>
                    </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{pa.createdAt ? pa.createdAt.toDate().toLocaleString() : '—'}</TableCell>
                {isUpdate ? (
                    <TableCell>{Object.keys(pa.updates || {}).join(', ')}</TableCell>
                ) : (
                    <TableCell className="hidden md:table-cell">{pa.phone || '—'}</TableCell>
                )}
                <TableCell className="text-right space-x-2">
                <Button size="sm" variant="outline" onClick={() => setSelected(pa)}>Review</Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={rejectingId === pa.id} onClick={() => handleReject(pa)}>
                    {rejectingId === pa.id ? "Rejecting..." : "Reject"}
                </Button>
                </TableCell>
            </TableRow>
            ))}
        </TableBody>
        </Table>
  );

  const renderCards = (data: PendingAccount[], isUpdate: boolean) => (
     <div className="space-y-3 p-2">
      {data.map((pa) => (
        <Card key={pa.id} className="p-4 space-y-3">
           <div className="flex justify-between items-start">
            <div className="space-y-1">
                <div className="font-semibold">{pa.fullName}</div>
                <div className="text-xs text-muted-foreground">{pa.email}</div>
            </div>
            <div className="text-right space-x-2">
                 <Button size="sm" variant="outline" onClick={() => setSelected(pa)}>Review</Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={rejectingId === pa.id} onClick={() => handleReject(pa)}>
                    {rejectingId === pa.id ? "..." : "X"}
                </Button>
            </div>
           </div>
           <div className="text-sm text-muted-foreground space-y-1">
             <p><strong>Requested:</strong> {pa.createdAt ? pa.createdAt.toDate().toLocaleString() : '—'}</p>
             {isUpdate ? (
                 <p><strong>Fields:</strong> {Object.keys(pa.updates || {}).join(', ')}</p>
             ) : (
                 <p><strong>Phone:</strong> {pa.phone || '—'}</p>
             )}
           </div>
        </Card>
      ))}
    </div>
  );


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
                        <div className="p-8 text-center text-sm text-muted-foreground">No pending account requests.</div>
                    ) : (
                        <>
                           <div className="hidden sm:block">
                             {renderTable(newAccounts, false)}
                           </div>
                           <div className="sm:hidden">
                             {renderCards(newAccounts, false)}
                           </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="profile-updates">
             <Card className="border shadow-sm bg-background mt-4">
                <CardContent className="p-0">
                    {profileUpdates.length === 0 ? (
                        <div className="p-8 text-center text-sm text-muted-foreground">No pending profile updates.</div>
                    ) : (
                        <>
                           <div className="hidden sm:block">
                             {renderTable(profileUpdates, true)}
                           </div>
                           <div className="sm:hidden">
                              {renderCards(profileUpdates, true)}
                           </div>
                        </>
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

    
