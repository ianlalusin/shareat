
"use client";

import { useState, useEffect, useMemo } from "react";
import type { Store, Package } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp, where, getDocs, writeBatch, setDoc, deleteDoc } from "firebase/firestore";
import { Loader, Edit, Power, PowerOff, Check, X, PlusCircle, Trash2, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { StorePackageEditDialog } from "@/components/manager/store-settings/store-package-edit-dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { isScheduleActiveNow } from "@/lib/utils/isScheduleActiveNow";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StorePackage, StoreFlavor, StoreRefill, KitchenLocation, MenuSchedule } from "@/lib/types";

export function StorePackagesSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();
    const { confirm, Dialog } = useConfirmDialog();

    const [globalPackages, setGlobalPackages] = useState<Package[]>([]);
    const [storePackages, setStorePackages] = useState<StorePackage[]>([]);
    const [kitchenLocations, setKitchenLocations] = useState<KitchenLocation[]>([]);
    const [refills, setRefills] = useState<StoreRefill[]>([]);
    const [flavors, setFlavors] = useState<StoreFlavor[]>([]);
    const [schedules, setSchedules] = useState<Map<string, MenuSchedule>>(new Map());
    
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingPackage, setEditingPackage] = useState<StorePackage | null>(null);
    const [availableNowFilter, setAvailableNowFilter] = useState(false);

    useEffect(() => {
        const unsubs: (()=>void)[] = [];
        
        unsubs.push(
          onSnapshot(
            query(
              collection(db, "packages"),
              where("isActive", "==", true),
              orderBy("updatedAt", "desc")
            ),
            (snap) => {
              const list = snap.docs
                .map((d) => ({ id: d.id, ...(d.data() as any) } as Package))
                .filter((p) => (p as any).isArchived !== true);
              setGlobalPackages(list);
            },
            (err) => {
              console.error("packages query failed", err);
              toast({ variant: "destructive", title: "Failed to load global packages", description: err.message });
              setGlobalPackages([]);
            }
          )
        );

        unsubs.push(onSnapshot(query(collection(db, "stores", store.id, "storePackages"), orderBy("sortOrder", "asc")), (snapshot) => {
            setStorePackages(snapshot.docs.map(doc => ({ packageId: doc.id, ...doc.data() } as StorePackage)));
        }));
        unsubs.push(onSnapshot(query(collection(db, "stores", store.id, "kitchenLocations"), where("isActive", "==", true)), (snapshot) => {
            setKitchenLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KitchenLocation)));
        }));
        unsubs.push(onSnapshot(query(collection(db, "stores", store.id, "storeRefills"), where("isEnabled", "==", true)), (snapshot) => {
            setRefills(snapshot.docs.map(doc => ({ ...doc.data() } as StoreRefill)));
        }));
        unsubs.push(onSnapshot(query(collection(db, "stores", store.id, "storeFlavors"), where("isEnabled", "==", true)), (snapshot) => {
            setFlavors(snapshot.docs.map(doc => ({ ...doc.data() } as StoreFlavor)));
        }));
        
        const schedulesQuery = query(collection(db, "stores", store.id, "menuSchedules"), where("isActive", "==", true));
        unsubs.push(onSnapshot(schedulesQuery, (snapshot) => {
            const schedulesMap = new Map<string, MenuSchedule>();
            snapshot.docs.forEach(doc => schedulesMap.set(doc.id, { id: doc.id, ...doc.data() } as MenuSchedule));
            setSchedules(schedulesMap);
        }));

        setIsLoading(false);
        return () => unsubs.forEach(unsub => unsub());
    }, [store.id, toast]);

    const filteredPackages = useMemo(() => {
        if (!availableNowFilter) {
            return storePackages;
        }
        return storePackages.filter(pkg => {
            if (!pkg.menuScheduleId) return true; // Always available if no schedule
            const schedule = schedules.get(pkg.menuScheduleId);
            if (!schedule) return false; // Fail closed if schedule not found yet.
            return isScheduleActiveNow(schedule);
        });
    }, [storePackages, schedules, availableNowFilter]);
    
    const availableGlobalPackages = useMemo(() => {
        const storePackageIds = new Set(storePackages.map(p => p.packageId));
        return globalPackages.filter(p => !storePackageIds.has(p.id));
    }, [globalPackages, storePackages]);

    const handleOpenDialog = (pkg: StorePackage) => {
        setEditingPackage(pkg);
        setIsDialogOpen(true);
    };

    const handleCloseDialog = () => {
        setEditingPackage(null);
        setIsDialogOpen(false);
    };

    const handleSave = async (data: Partial<StorePackage>) => {
        if (!appUser || !editingPackage) return;
        const docRef = doc(db, "stores", store.id, "storePackages", editingPackage.packageId);
        try {
            await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
            toast({ title: "Package Updated" });
            handleCloseDialog();
        } catch (error: any) {
            toast({ variant: "destructive", title: "Save Failed", description: error.message });
        }
    };
    
    const handleToggleEnabled = async (pkg: StorePackage) => {
        if (!appUser) return;
        const newStatus = !pkg.isEnabled;
        if (!(await confirm({ title: `${newStatus ? 'Enable' : 'Disable'} ${pkg.packageName}?` }))) return;

        const docRef = doc(db, "stores", store.id, "storePackages", pkg.packageId);
        await updateDoc(docRef, { isEnabled: newStatus, updatedAt: serverTimestamp() });
        toast({ title: "Status Updated" });
    };

    const handleAddPackage = async (gPackage: Package) => {
        if (!appUser) return;
        const docRef = doc(db, "stores", store.id, "storePackages", gPackage.id);
        
        try {
             const newStorePackage: StorePackage = {
                packageId: gPackage.id,
                packageName: gPackage.name,
                isEnabled: true, // Default to enabled
                pricePerHead: 0,
                sortOrder: 1000,
                kitchenLocationId: null,
                kitchenLocationName: null,
                refillsAllowed: gPackage.allowedRefillIds || [],
                flavorsAllowed: [],
                menuScheduleId: null,
            };
            await setDoc(docRef, newStorePackage);
            toast({ title: "Package Added", description: `"${gPackage.name}" added to your store. Please edit to set a price.`});
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Failed to Add", description: error.message });
        }
    };
    
     const handleSync = async () => {
        if (!appUser || !store) return;
        setIsSyncing(true);
        toast({ title: "Syncing...", description: "Adding new global packages to your store settings." });

        const existingStoreIds = new Set(storePackages.map(p => p.packageId));
        const batch = writeBatch(db);
        let newCount = 0;

        globalPackages.forEach(gPackage => {
            if (!existingStoreIds.has(gPackage.id)) {
                const docRef = doc(db, "stores", store.id, "storePackages", gPackage.id);
                batch.set(docRef, {
                    packageId: gPackage.id,
                    packageName: gPackage.name,
                    isEnabled: false,
                    pricePerHead: 0,
                    sortOrder: 1000,
                    kitchenLocationId: null,
                    kitchenLocationName: null,
                    refillsAllowed: gPackage.allowedRefillIds || [],
                    flavorsAllowed: [],
                    menuScheduleId: null,
                });
                newCount++;
            }
        });

        try {
            await batch.commit();
            if (newCount > 0) {
                toast({ title: "Sync Complete", description: `Added ${newCount} new package(s).` });
            } else {
                toast({ title: "Already Up-to-Date", description: "No new global packages to add." });
            }
        } catch (error: any) {
             toast({ variant: 'destructive', title: "Sync Failed", description: error.message });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleDelete = async (pkg: StorePackage) => {
        if (!appUser) return;
        if (!(await confirm({ 
            title: `Delete ${pkg.packageName}?`,
            description: "This will permanently remove the package from this store's menu. This cannot be undone.",
            confirmText: "Yes, Delete",
            destructive: true,
        }))) return;

        const docRef = doc(db, "stores", store.id, "storePackages", pkg.packageId);
        try {
            await deleteDoc(docRef);
            toast({ title: "Package Deleted" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Delete Failed", description: error.message });
        }
    };


    if (isLoading) return <Loader className="animate-spin" />;

    return (
        <>
            <div className="grid md:grid-cols-3 gap-6">
                <Card className="md:col-span-2">
                    <CardHeader>
                        <div className="flex justify-between items-start">
                            <div>
                                <CardTitle>Store Packages</CardTitle>
                                <CardDescription>Manage packages available for sale in this store.</CardDescription>
                            </div>
                            <div className="flex items-center space-x-4">
                                <Button onClick={handleSync} disabled={isSyncing} variant="outline" size="sm">
                                    {isSyncing ? <Loader className="animate-spin mr-2"/> : <RefreshCw className="mr-2"/>}
                                    Sync Global Packages
                                </Button>
                                <div className="flex items-center space-x-2">
                                    <Switch id="available-now-filter" checked={availableNowFilter} onCheckedChange={setAvailableNowFilter}/>
                                    <Label htmlFor="available-now-filter">Available Now</Label>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Package Name</TableHead>
                                    <TableHead>Price/Head</TableHead>
                                    <TableHead>Schedule</TableHead>
                                    <TableHead>Enabled</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredPackages.map(pkg => (
                                    <TableRow key={pkg.packageId} className={!pkg.isEnabled ? "text-muted-foreground" : ""}>
                                        <TableCell className="font-medium">{pkg.packageName}</TableCell>
                                        <TableCell>₱{pkg.pricePerHead.toFixed(2)}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-normal">
                                                {schedules.get(pkg.menuScheduleId || "")?.name || "Always On"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {pkg.isEnabled ? <Check className="text-green-500"/> : <X className="text-destructive"/>}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(pkg)}><Edit className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleToggleEnabled(pkg)}>
                                                {pkg.isEnabled ? <PowerOff className="h-4 w-4 text-destructive" /> : <Power className="h-4 w-4" />}
                                            </Button>
                                            {appUser?.role === 'admin' && (
                                                <Button variant="ghost" size="icon" onClick={() => handleDelete(pkg)}>
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader>
                        <CardTitle>Add from Global Packages</CardTitle>
                        <CardDescription>Select global packages to make them available in this store.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ScrollArea className="h-96">
                            {availableGlobalPackages.length > 0 ? (
                                <div className="space-y-2">
                                    {availableGlobalPackages.map(gPackage => (
                                        <div key={gPackage.id} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-md">
                                            <span className="font-medium">{gPackage.name}</span>
                                            <Button size="sm" variant="outline" onClick={() => handleAddPackage(gPackage)}><PlusCircle /></Button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-center text-sm text-muted-foreground py-10">All global packages have been added.</p>
                            )}
                        </ScrollArea>
                    </CardContent>
                </Card>
            </div>
            {isDialogOpen && editingPackage && (
                <StorePackageEditDialog
                    isOpen={isDialogOpen}
                    onClose={handleCloseDialog}
                    onSave={handleSave}
                    item={editingPackage}
                    kitchenLocations={kitchenLocations}
                    availableRefills={refills}
                    availableFlavors={flavors}
                    availableSchedules={Array.from(schedules.values())}
                />
            )}
            {Dialog}
        </>
    );
}
