
"use client";

import { useState, useEffect, useMemo } from "react";
import { Store } from "@/app/admin/stores/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, orderBy, doc, updateDoc, serverTimestamp, where, getDocs } from "firebase/firestore";
import { Loader, Edit, Power, PowerOff, Check, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { logActivity } from "@/lib/firebase/activity-log";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { StorePackageEditDialog, type StorePackage } from "./store-package-edit-dialog";
import { KitchenLocation } from "./kitchen-location-edit-dialog";
import { MenuSchedule } from "./schedules-settings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { isScheduleActiveNow } from "./utils/isScheduleActiveNow";
import { StoreFlavor } from "./store-flavors-settings";

export type StoreRefill = {
    refillId: string,
    refillName: string,
    isEnabled: boolean,
    sortOrder: number,
};

export function StorePackagesSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();
    const { confirm, Dialog } = useConfirmDialog();

    const [packages, setPackages] = useState<StorePackage[]>([]);
    const [kitchenLocations, setKitchenLocations] = useState<KitchenLocation[]>([]);
    const [refills, setRefills] = useState<StoreRefill[]>([]);
    const [flavors, setFlavors] = useState<StoreFlavor[]>([]);
    const [schedules, setSchedules] = useState<Map<string, MenuSchedule>>(new Map());
    
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingPackage, setEditingPackage] = useState<StorePackage | null>(null);
    const [availableNowFilter, setAvailableNowFilter] = useState(false);

    useEffect(() => {
        const unsubs: (()=>void)[] = [];
        
        unsubs.push(onSnapshot(query(collection(db, "stores", store.id, "storePackages"), orderBy("sortOrder", "asc")), (snapshot) => {
            setPackages(snapshot.docs.map(doc => ({ ...doc.data() } as StorePackage)));
        }));
        unsubs.push(onSnapshot(query(collection(db, "stores", store.id, "kitchenLocations"), where("isActive", "==", true)), (snapshot) => {
            setKitchenLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KitchenLocation)));
        }, (error) => {
            console.error("Failed to load kitchen locations:", error);
            toast({ variant: "destructive", title: "Error", description: "Could not fetch kitchen locations." });
        }));
        unsubs.push(onSnapshot(query(collection(db, "stores", store.id, "storeRefills"), where("isEnabled", "==", true)), (snapshot) => {
            setRefills(snapshot.docs.map(doc => ({ ...doc.data() } as StoreRefill)));
        }));
        unsubs.push(onSnapshot(query(collection(db, "stores", store.id, "storeFlavors"), where("isEnabled", "==", true)), (snapshot) => {
            setFlavors(snapshot.docs.map(doc => ({ ...doc.data() } as StoreFlavor)));
        }));
        
        // Fetch all schedules at once from the store's subcollection
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
            return packages;
        }
        return packages.filter(pkg => {
            if (!pkg.menuScheduleId) return true; // Always available if no schedule
            const schedule = schedules.get(pkg.menuScheduleId);
            if (!schedule) return true; // Fail open if schedule not found
            return isScheduleActiveNow(schedule);
        });
    }, [packages, schedules, availableNowFilter]);

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
                        <div className="flex items-center space-x-2">
                            <Switch id="available-now-filter" checked={availableNowFilter} onCheckedChange={setAvailableNowFilter}/>
                            <Label htmlFor="available-now-filter">Available Now</Label>
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
