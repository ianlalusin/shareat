
"use client";

import { useState, useEffect } from "react";
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, deleteDoc } from "firebase/firestore";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ChevronsUpDown, Loader } from "lucide-react";
import { db, auth } from "@/lib/firebase/client";
import { Separator } from "@/components/ui/separator";
import { AppUser, useAuthContext } from "@/context/auth-context";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { UserDetailsModal, type StoreOption } from "@/components/admin/user-details-modal";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { logActivity } from "@/lib/firebase/activity-log";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { cleanupRadixOverlays } from "@/lib/ui/cleanup-radix";
import { UserRole } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const roles: UserRole[] = ['admin', 'manager', 'cashier', 'kitchen', 'server'];

export default function UserManagementPage() {
    const { appUser } = useAuthContext();
    const { toast } = useToast();
    const [pendingUsers, setPendingUsers] = useState<AppUser[]>([]);
    const [activeUsers, setActiveUsers] = useState<AppUser[]>([]);
    const [deactivatedUsers, setDeactivatedUsers] = useState<AppUser[]>([]);
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);
    const [isProcessing, setIsProcessing] = useState<Record<string, boolean>>({});
    const [selectedUser, setSelectedUser] = useState<AppUser | null>(null);
    const { confirm, Dialog } = useConfirmDialog();
    
    const [availableStores, setAvailableStores] = useState<StoreOption[]>([]);
    const [selectedRoles, setSelectedRoles] = useState<Record<string, UserRole>>({});
    const [selectedStoreAssignments, setSelectedStoreAssignments] = useState<Record<string, string[]>>({});
    const [popoverOpen, setPopoverOpen] = useState<Record<string, boolean>>({});


    useEffect(() => {
        if (!appUser) return;
        
        const usersRef = collection(db, "users");
        let pendingUnsub: Function | null = null;
        let activeUnsub: Function | null = null;
        let deactivatedUnsub: Function | null = null;
        let storesUnsub: Function | null = null;

        function fetchUsers() {
            setIsLoadingUsers(true);
            
            // Fetch active stores
            const storesQuery = query(collection(db, "stores"), where("isActive", "==", true));
            storesUnsub = onSnapshot(storesQuery, (snapshot) => {
                const storesData = snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name })) as StoreOption[];
                setAvailableStores(storesData);
            }, (error) => console.error("Failed to fetch stores:", error));

            const qPending = query(usersRef, where("status", "==", "pending"));
            pendingUnsub = onSnapshot(qPending, (querySnapshot) => {
                const users: AppUser[] = [];
                querySnapshot.forEach((doc) => {
                    users.push({ uid: doc.id, ...doc.data() } as AppUser);
                });
                setPendingUsers(users);
                setIsLoadingUsers(false);
            }, (error) => {
                console.error("Failed to fetch pending users:", error);
                setIsLoadingUsers(false);
            });
    
            const qActive = query(usersRef, where("status", "==", "active"));
            activeUnsub = onSnapshot(qActive, (querySnapshot) => {
                const users: AppUser[] = [];
                querySnapshot.forEach((doc) => {
                    users.push({ uid: doc.id, ...doc.data() } as AppUser);
                });
                setActiveUsers(users);
            }, (error) => {
                console.error("Failed to fetch active users:", error);
            });

            const qDeactivated = query(usersRef, where("status", "==", "disabled"));
            deactivatedUnsub = onSnapshot(qDeactivated, (querySnapshot) => {
                const users: AppUser[] = [];
                querySnapshot.forEach((doc) => {
                    users.push({ uid: doc.id, ...doc.data() } as AppUser);
                });
                setDeactivatedUsers(users);
            }, (error) => {
                console.error("Failed to fetch deactivated users:", error);
            });
        }

        if (appUser.role === 'admin') {
            fetchUsers();
        } else {
            setIsLoadingUsers(false);
        }

        return () => {
            if (pendingUnsub) pendingUnsub();
            if (activeUnsub) activeUnsub();
            if (deactivatedUnsub) deactivatedUnsub();
            if (storesUnsub) storesUnsub();
        };
    }, [appUser]);

    async function handleApproveUser(user: AppUser) {
        if (!appUser) return;
        
        const roleToAssign = selectedRoles[user.uid] || 'server';
        const storesToAssign = selectedStoreAssignments[user.uid] || [];

        if (storesToAssign.length === 0 && appUser.role !== 'admin') {
            toast({
                variant: "destructive",
                title: "Assignment Required",
                description: "Please assign at least one store to the user.",
            });
            return;
        }

        setIsProcessing(prev => ({...prev, [user.uid]: true}));
        try {
            console.log("ADMIN AUTH:", auth.currentUser?.uid, auth.currentUser?.email);
            console.log("APPROVING TARGET:", user.uid, user.email);
            const userDocRef = doc(db, "users", user.uid);
            await updateDoc(userDocRef, {
                status: "active",
                role: roleToAssign,
                roles: [roleToAssign],
                assignedStoreIds: storesToAssign,
                // Set the first assigned store as the active one
                storeId: storesToAssign[0] || null,
                updatedAt: serverTimestamp(),
            });
            console.log("AFTER APPROVE AUTH:", auth.currentUser?.uid, auth.currentUser?.email);
            
            await logActivity(appUser, "user_approved", `Approved user: ${user.email}`, {
                approvedUid: user.uid,
                role: roleToAssign,
                stores: storesToAssign,
            });

            toast({
                title: "User Approved",
                description: `${user.name || user.email} has been activated.`,
            });
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Approval Failed",
                description: error.message || "Could not approve the user.",
            });
        } finally {
            setIsProcessing(prev => ({...prev, [user.uid]: false}));
            cleanupRadixOverlays();
        }
    }

    async function handleRejectUser(user: AppUser) {
        if (!appUser) return;
        
        try {
            const confirmed = await confirm({
                title: `Reject ${user.name || 'user'}?`,
                description: "This will disable the user's account and they will not be able to log in. This action can be undone later.",
                confirmText: "Yes, Reject",
                destructive: true,
            });
    
            if (!confirmed) return;
            
            await handleUpdateUserStatus(user.uid, 'disabled');
            await logActivity(appUser, "user_rejected", `Rejected user: ${user.email}`);
        } finally {
            cleanupRadixOverlays();
        }

    }

    async function handleUpdateUserStatus(uid: string, status: 'active' | 'disabled') {
        const pastTenseVerb = status === 'disabled' ? 'deactivated' : 'reactivated';
        setIsProcessing(prev => ({...prev, [uid]: true}));
        try {
            const userDocRef = doc(db, "users", uid);
            await updateDoc(userDocRef, {
                status,
                updatedAt: serverTimestamp(),
            });
            toast({
                title: `User ${pastTenseVerb}`,
                description: `The user account has been ${pastTenseVerb}.`,
            });
            setSelectedUser(null);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: `Action Failed`,
                description: error.message || `Could not update the user status.`,
            });
        } finally {
            setIsProcessing(prev => ({...prev, [uid]: false}));
        }
    }

    async function handleDeleteUser(uid: string, name?: string) {
        const confirmed = await confirm({
            title: `Permanently delete ${name || 'user'}?`,
            description: "This action cannot be undone. This will permanently delete the user's data.",
            confirmText: "Yes, Delete Permanently",
            destructive: true,
});

        if (!confirmed) return;

        setIsProcessing(prev => ({...prev, [uid]: true}));
        try {
            const userDocRef = doc(db, "users", uid);
            await deleteDoc(userDocRef);
            toast({
                title: "User Deleted",
                description: "The user account has been permanently removed.",
            });
            setSelectedUser(null);
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Deletion Failed",
                description: error.message || "Could not delete the user.",
            });
        } finally {
            setIsProcessing(prev => ({...prev, [uid]: false}));
        }
    }

    async function handleUpdateUserDetails(uid: string, data: Partial<AppUser>) {
        setIsProcessing(prev => ({ ...prev, [uid]: true }));
        try {
            const userDocRef = doc(db, "users", uid);
            await updateDoc(userDocRef, {
                ...data,
                updatedAt: serverTimestamp(),
            });
            toast({
                title: "User Updated",
                description: "The user's details have been successfully updated.",
            });
            if (selectedUser && selectedUser.uid === uid) {
                setSelectedUser(prev => prev ? { ...prev, ...data } : null);
            }
        } catch (error: any) {
            toast({
                variant: "destructive",
                title: "Update Failed",
                description: error.message || "Could not update user details.",
            });
        } finally {
            setIsProcessing(prev => ({ ...prev, [uid]: false }));
        }
    }

    const handleRoleSelect = (uid: string, role: UserRole) => {
        setSelectedRoles(prev => ({...prev, [uid]: role}));
    };

    const handleStoreSelect = (uid: string, storeId: string) => {
        setSelectedStoreAssignments(prev => {
            const current = prev[uid] || [];
            const newAssignments = current.includes(storeId)
                ? current.filter(id => id !== storeId)
                : [...current, storeId];
            return {...prev, [uid]: newAssignments};
        });
    };

    return (
        <RoleGuard allow={["admin"]}>
            <PageHeader title="User Management" description="Manage roles, permissions, and verify new user accounts." />
             <div className="grid gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Pending User Approvals</CardTitle>
                        <CardDescription>Review, assign roles/stores, and approve new user accounts.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoadingUsers ? <Loader className="animate-spin" /> : (
                            pendingUsers.length > 0 ? (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>User</TableHead>
                                            <TableHead>Assign Role</TableHead>
                                            <TableHead>Assign Stores</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {pendingUsers.map(user => {
                                            const assigned = selectedStoreAssignments[user.uid] || [];
                                            return (
                                            <TableRow key={user.uid}>
                                                <TableCell>
                                                    <div className="font-medium">{user.name}</div>
                                                    <div className="text-sm text-muted-foreground">{user.email}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <Select value={selectedRoles[user.uid]} onValueChange={(role: UserRole) => handleRoleSelect(user.uid, role)}>
                                                        <SelectTrigger className="w-[140px]">
                                                            <SelectValue placeholder="Set role..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {roles.filter(r => r !== 'admin').map(role => (
                                                                <SelectItem key={role} value={role} className="capitalize">{role}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </TableCell>
                                                <TableCell>
                                                    <Popover open={popoverOpen[user.uid]} onOpenChange={(isOpen) => setPopoverOpen(prev => ({ ...prev, [user.uid]: isOpen }))}>
                                                        <PopoverTrigger asChild>
                                                            <Button variant="outline" role="combobox" className="w-[200px] justify-between">
                                                                <span className="truncate">
                                                                    {assigned.length > 0 ? `${assigned.length} store${assigned.length > 1 ? 's' : ''} selected` : "Select stores..."}
                                                                </span>
                                                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-[200px] p-0">
                                                            <Command>
                                                                <CommandInput placeholder="Search store..." />
                                                                <CommandList>
                                                                    <CommandEmpty>No stores found.</CommandEmpty>
                                                                    <CommandGroup>
                                                                        {availableStores.map((store) => (
                                                                            <CommandItem
                                                                                key={store.id}
                                                                                onSelect={() => handleStoreSelect(user.uid, store.id)}
                                                                            >
                                                                                <Check className={cn("mr-2 h-4 w-4", assigned.includes(store.id) ? "opacity-100" : "opacity-0")} />
                                                                                {store.name}
                                                                            </CommandItem>
                                                                        ))}
                                                                    </CommandGroup>
                                                                </CommandList>
                                                            </Command>
                                                        </PopoverContent>
                                                    </Popover>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="ghost" size="sm" onClick={() => setSelectedUser(user)}>Details</Button>
                                                    <Button 
                                                        size="sm" 
                                                        className="ml-2"
                                                        onClick={() => handleApproveUser(user)}
                                                        disabled={isProcessing[user.uid] || (selectedStoreAssignments[user.uid] || []).length === 0}
                                                    >
                                                        {isProcessing[user.uid] ? 'Processing...' : 'Approve'}
                                                    </Button>
                                                     <Button 
                                                        variant="destructive"
                                                        size="sm" 
                                                        className="ml-2"
                                                        onClick={() => handleRejectUser(user)}
                                                        disabled={isProcessing[user.uid]}
                                                    >
                                                        Reject
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        )})}
                                    </TableBody>
                                </Table>
                            ) : <p className="text-muted-foreground text-center py-4">No pending users.</p>
                        )}
                    </CardContent>
                </Card>

                <Separator />

                <Card>
                    <CardHeader>
                        <CardTitle>Active Users</CardTitle>
                        <CardDescription>Manage existing users in the system.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {activeUsers.length > 0 ? (
                             <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead>Active Store</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {activeUsers.map(user => (
                                        <TableRow key={user.uid} onClick={() => setSelectedUser(user)} className="cursor-pointer">
                                            <TableCell>{user.name}</TableCell>
                                            <TableCell>{user.email}</TableCell>
                                            <TableCell className="capitalize">{user.role}</TableCell>
                                            <TableCell>{user.storeId ? availableStores.find(s => s.id === user.storeId)?.name || 'N/A' : 'N/A'}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="outline" size="sm">Manage</Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : <p className="text-muted-foreground text-center py-4">No active users.</p>}
                    </CardContent>
                </Card>

                <Separator />

                <Card>
                    <CardHeader>
                        <CardTitle>Deactivated Users</CardTitle>
                        <CardDescription>Manage user accounts that have been disabled.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {deactivatedUsers.length > 0 ? (
                             <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Email</TableHead>
                                        <TableHead>Role</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {deactivatedUsers.map(user => (
                                        <TableRow key={user.uid} onClick={() => setSelectedUser(user)} className="cursor-pointer">
                                            <TableCell>{user.name}</TableCell>
                                            <TableCell>{user.email}</TableCell>
                                            <TableCell className="capitalize">{user.role}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="outline" size="sm">Manage</Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : <p className="text-muted-foreground text-center py-4">No deactivated users.</p>}
                    </CardContent>
                </Card>
            </div>

            {selectedUser && appUser && (
                <UserDetailsModal
                    user={selectedUser}
                    isOpen={!!selectedUser}
                    onClose={() => setSelectedUser(null)}
                    currentUserRole={appUser.role}
                    currentUserId={appUser.uid}
                    availableStores={availableStores}
                    onDeactivate={async (user) => {
                        const confirmed = await confirm({
                            title: `Deactivate ${user.name || 'user'}?`,
                            description: "This will disable the user's account and they will not be able to log in.",
                            confirmText: "Yes, Deactivate",
                            destructive: true,
                        });
                        if (confirmed) {
                           await handleUpdateUserStatus(user.uid, 'disabled');
                        }
                    }}
                    onReactivate={async (user) => {
                        const confirmed = await confirm({
                            title: `Reactivate ${user.name || 'user'}?`,
                            description: "This will enable the user's account, allowing them to log in.",
                            confirmText: "Yes, Reactivate",
                            destructive: false,
                        });
                        if (confirmed) {
                           await handleUpdateUserStatus(user.uid, 'active');
                        }
                    }}
                    onDelete={handleDeleteUser}
                    onUpdate={handleUpdateUserDetails}
                    isProcessing={isProcessing[selectedUser.uid]}
                />
            )}
            {Dialog}
        </RoleGuard>
    );
}
