
"use client";

import { useState, useEffect, useMemo } from "react";
import type { Store, Package } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp, where, getDocs, writeBatch } from "firebase/firestore";
import { Loader, Edit, Power, PowerOff, Check, X, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { logActivity } from "@/lib/firebase/activity-log";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { StorePackageEditDialog } from "./_components/StorePackageEditDialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { isScheduleActiveNow } from "./_utils/isScheduleActiveNow";
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
        
        unsubs.push(onSnapshot(query(collection(db, "packages"), where("isActive", "==", true)), (snap) => {
            setGlobalPackages(snap.docs.map(d => d.data() as Package));
        }));

        unsubs.push(onSnapshot(query(collection(db, "stores", store.id, "storePackages"), orderBy("sortOrder", "asc")), (snapshot) => {
            setStorePackages(snapshot.docs.map(doc => ({ ...doc.data() } as StorePackage)));
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
            await logActivity(appUser, "store_package_updated", `Updated store package: ${editingPackage.packageName}`);
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
        await logActivity(appUser, `store_package_${newStatus ? 'enabled' : 'disabled'}`, `${pkg.packageName} was ${newStatus ? 'enabled' : 'disabled'}`);
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
                await logActivity(appUser, 'store_packages_synced', `Synced ${newCount} packages.`);
            } else {
                toast({ title: "Already Up-to-Date", description: "No new global packages to add." });
            }
        } catch (error: any) {
             toast({ variant: 'destructive', title: "Sync Failed", description: error.message });
        } finally {
            setIsSyncing(false);
        }
    };

    if (isLoading) return <Loader className="animate-spin" />;

    return (
        <>
            <Card>
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
                                <TableHead>Sort</TableHead>
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
                                    <TableCell>{pkg.sortOrder}</TableCell>
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
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
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
