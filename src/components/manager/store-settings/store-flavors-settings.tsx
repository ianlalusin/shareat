
"use client";

import { useState, useEffect, useMemo } from "react";
import { Store } from "@/app/admin/stores/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, getDocs, setDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { Loader, Edit, Power, PowerOff } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { logActivity } from "@/lib/firebase/activity-log";
import { Flavor } from "@/app/admin/menu/flavors/page";

export type StoreFlavor = {
    flavorId: string,
    flavorName: string, // denormalized
    isEnabled: boolean,
    sortOrder: number,
}

export function StoreFlavorsSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();

    const [globalFlavors, setGlobalFlavors] = useState<Flavor[]>([]);
    const [storeFlavors, setStoreFlavors] = useState<Map<string, StoreFlavor>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    
    // State for inline editing
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingSortOrder, setEditingSortOrder] = useState<number>(0);


    // Fetch global and store-specific flavors
    useEffect(() => {
        const unsubGlobal = onSnapshot(query(collection(db, "flavors"), where("isActive", "==", true)), (snap) => {
            setGlobalFlavors(snap.docs.map(d => d.data() as Flavor));
        });

        const unsubStore = onSnapshot(collection(db, "stores", store.id, "storeFlavors"), (snap) => {
            const map = new Map<string, StoreFlavor>();
            snap.forEach(doc => map.set(doc.id, doc.data() as StoreFlavor));
            setStoreFlavors(map);
        });

        setIsLoading(false);
        return () => {
            unsubGlobal();
            unsubStore();
        }
    }, [store.id]);

    const combinedFlavors = useMemo(() => {
        return globalFlavors.map(gFlavor => {
            const sFlavor = storeFlavors.get(gFlavor.id);
            return {
                flavorId: gFlavor.id,
                flavorName: gFlavor.name,
                isEnabled: sFlavor?.isEnabled ?? false,
                sortOrder: sFlavor?.sortOrder ?? 1000,
            }
        }).sort((a,b) => a.sortOrder - b.sortOrder || a.flavorName.localeCompare(b.flavorName));
    }, [globalFlavors, storeFlavors]);

    const handleSync = async () => {
        if (!appUser) return;
        setIsSyncing(true);
        toast({ title: "Syncing...", description: "Adding new global flavors to your store settings." });

        const batch = writeBatch(db);
        let newCount = 0;

        globalFlavors.forEach(gFlavor => {
            if (!storeFlavors.has(gFlavor.id)) {
                const docRef = doc(db, "stores", store.id, "storeFlavors", gFlavor.id);
                batch.set(docRef, {
                    flavorId: gFlavor.id,
                    flavorName: gFlavor.name,
                    isEnabled: false, // Default to disabled
                    sortOrder: 1000,
                });
                newCount++;
            }
        });

        try {
            await batch.commit();
            if (newCount > 0) {
                toast({ title: "Sync Complete", description: `Added ${newCount} new flavor(s).` });
                await logActivity(appUser, 'store_flavors_synced', `Synced ${newCount} flavors.`);
            } else {
                toast({ title: "Already Up-to-Date", description: "No new global flavors to add." });
            }
        } catch (error: any) {
             toast({ variant: 'destructive', title: "Sync Failed", description: error.message });
        } finally {
            setIsSyncing(false);
        }
    }
    
    const handleToggleEnabled = async (flavorId: string, currentStatus: boolean) => {
        if (!appUser) return;
        const flavor = combinedFlavors.find(f => f.flavorId === flavorId);
        if (!flavor) return;

        const docRef = doc(db, "stores", store.id, "storeFlavors", flavorId);
        try {
            await setDoc(docRef, { 
                ...flavor, 
                isEnabled: !currentStatus 
            }, { merge: true });
            toast({ title: "Status Updated" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Update Failed", description: error.message });
        }
    };
    
    const handleSaveSortOrder = async (flavorId: string) => {
        if (!appUser) return;
        const flavor = combinedFlavors.find(f => f.flavorId === flavorId);
        if (!flavor) return;

        const docRef = doc(db, "stores", store.id, "storeFlavors", flavorId);
        try {
             await setDoc(docRef, { 
                ...flavor, 
                sortOrder: editingSortOrder,
            }, { merge: true });
            toast({ title: "Sort Order Saved" });
            setEditingId(null);
        } catch (error: any) {
             toast({ variant: 'destructive', title: "Save Failed", description: error.message });
        }
    };

    if (isLoading) return <Loader className="animate-spin" />;

    return (
        <Card>
            <CardHeader>
                 <div className="flex justify-between items-center">
                    <div>
                        <CardTitle>Store Flavors</CardTitle>
                        <CardDescription>Manage which global flavors are available in this store.</CardDescription>
                    </div>
                    <Button onClick={handleSync} disabled={isSyncing}>
                        {isSyncing ? <Loader className="animate-spin mr-2"/> : null}
                        Sync Global Flavors
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Flavor</TableHead>
                            <TableHead>Enabled</TableHead>
                            <TableHead>Sort Order</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {combinedFlavors.map(flavor => (
                            <TableRow key={flavor.flavorId} className={!flavor.isEnabled ? "text-muted-foreground" : ""}>
                                <TableCell className="font-medium">{flavor.flavorName}</TableCell>
                                <TableCell>
                                     <Switch 
                                        checked={flavor.isEnabled}
                                        onCheckedChange={() => handleToggleEnabled(flavor.flavorId, flavor.isEnabled)}
                                    />
                                </TableCell>
                                <TableCell>
                                    {editingId === flavor.flavorId ? (
                                         <Input 
                                            type="number"
                                            value={editingSortOrder}
                                            onChange={(e) => setEditingSortOrder(Number(e.target.value))}
                                            className="w-24 h-8"
                                        />
                                    ) : (
                                        flavor.sortOrder
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    {editingId === flavor.flavorId ? (
                                        <>
                                            <Button size="sm" onClick={() => handleSaveSortOrder(flavor.flavorId)}>Save</Button>
                                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                                        </>
                                    ) : (
                                        <Button variant="ghost" size="icon" onClick={() => {setEditingId(flavor.flavorId); setEditingSortOrder(flavor.sortOrder)}}>
                                            <Edit className="h-4 w-4" />
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}

