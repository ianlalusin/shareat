
"use client";

import { useState, useEffect, useMemo } from "react";
import { Store } from "@/app/admin/stores/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { Loader, Edit, Power, PowerOff, Save } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { logActivity } from "@/lib/firebase/activity-log";
import { Refill } from "@/app/admin/menu/refills/page";
import { KitchenLocation } from "./kitchen-location-edit-dialog";

export type StoreRefill = {
    refillId: string,
    refillName: string, // denormalized
    isEnabled: boolean,
    sortOrder: number,
    kitchenLocationId: string | null;
    kitchenLocationName: string | null;
    flavorsAllowed?: string[] | null;
}

export function StoreRefillsSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();

    const [globalRefills, setGlobalRefills] = useState<Refill[]>([]);
    const [storeRefills, setStoreRefills] = useState<Map<string, StoreRefill>>(new Map());
    const [kitchenLocations, setKitchenLocations] = useState<KitchenLocation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSyncing, setIsSyncing] = useState(false);
    
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingValues, setEditingValues] = useState<Partial<StoreRefill>>({});

    useEffect(() => {
        const unsubGlobal = onSnapshot(query(collection(db, "refills"), where("isActive", "==", true)), (snap) => {
            setGlobalRefills(snap.docs.map(d => d.data() as Refill));
        });

        const unsubStore = onSnapshot(collection(db, "stores", store.id, "storeRefills"), (snap) => {
            const map = new Map<string, StoreRefill>();
            snap.forEach(doc => map.set(doc.id, doc.data() as StoreRefill));
            setStoreRefills(map);
        });
        
        const unsubKitchen = onSnapshot(query(collection(db, "stores", store.id, "kitchenLocations"), where("isActive", "==", true)), (snap) => {
            setKitchenLocations(snap.docs.map(d => d.data() as KitchenLocation));
        });

        setIsLoading(false);
        return () => {
            unsubGlobal();
            unsubStore();
            unsubKitchen();
        }
    }, [store.id]);

    const combinedRefills = useMemo(() => {
        return globalRefills.map(gRefill => {
            const sRefill = storeRefills.get(gRefill.id);
            return {
                refillId: gRefill.id,
                refillName: gRefill.name,
                isEnabled: sRefill?.isEnabled ?? false,
                sortOrder: sRefill?.sortOrder ?? 1000,
                kitchenLocationId: sRefill?.kitchenLocationId || null,
                kitchenLocationName: sRefill?.kitchenLocationName || null,
            }
        }).sort((a,b) => a.sortOrder - b.sortOrder || a.refillName.localeCompare(b.refillName));
    }, [globalRefills, storeRefills]);

    const handleSync = async () => {
        if (!appUser) return;
        setIsSyncing(true);
        toast({ title: "Syncing...", description: "Adding new global refills to your store settings." });

        const batch = writeBatch(db);
        let newCount = 0;

        globalRefills.forEach(gRefill => {
            if (!storeRefills.has(gRefill.id)) {
                const docRef = doc(db, "stores", store.id, "storeRefills", gRefill.id);
                batch.set(docRef, {
                    refillId: gRefill.id,
                    refillName: gRefill.name,
                    isEnabled: false,
                    sortOrder: 1000,
                    kitchenLocationId: null,
                    kitchenLocationName: null,
                });
                newCount++;
            }
        });

        try {
            await batch.commit();
            if (newCount > 0) {
                toast({ title: "Sync Complete", description: `Added ${newCount} new refill(s).` });
                await logActivity(appUser, 'store_refills_synced', `Synced ${newCount} refills.`);
            } else {
                toast({ title: "Already Up-to-Date", description: "No new global refills to add." });
            }
        } catch (error: any) {
             toast({ variant: 'destructive', title: "Sync Failed", description: error.message });
        } finally {
            setIsSyncing(false);
        }
    }
    
    const handleToggleEnabled = async (refillId: string, currentStatus: boolean) => {
        if (!appUser) return;
        const refill = combinedRefills.find(f => f.refillId === refillId);
        if (!refill) return;

        const docRef = doc(db, "stores", store.id, "storeRefills", refillId);
        try {
            await setDoc(docRef, { ...refill, isEnabled: !currentStatus }, { merge: true });
            toast({ title: "Status Updated" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Update Failed", description: error.message });
        }
    };
    
    const handleEdit = (refill: StoreRefill) => {
        setEditingId(refill.refillId);
        setEditingValues({
            sortOrder: refill.sortOrder,
            kitchenLocationId: refill.kitchenLocationId,
        });
    }

    const handleSave = async (refillId: string) => {
        if (!appUser) return;
        const docRef = doc(db, "stores", store.id, "storeRefills", refillId);
        
        const kitchenLocationName = kitchenLocations.find(k => k.id === editingValues.kitchenLocationId)?.name || null;

        try {
             await updateDoc(docRef, { 
                sortOrder: editingValues.sortOrder,
                kitchenLocationId: editingValues.kitchenLocationId,
                kitchenLocationName: kitchenLocationName
            });
            toast({ title: "Refill Updated" });
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
                        <CardTitle>Store Refills</CardTitle>
                        <CardDescription>Manage which global refills are available in this store.</CardDescription>
                    </div>
                    <Button onClick={handleSync} disabled={isSyncing}>
                        {isSyncing ? <Loader className="animate-spin mr-2"/> : null}
                        Sync Global Refills
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Refill</TableHead>
                            <TableHead>Kitchen</TableHead>
                            <TableHead>Sort</TableHead>
                            <TableHead>Enabled</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {combinedRefills.map(refill => (
                            <TableRow key={refill.refillId} className={!refill.isEnabled ? "text-muted-foreground" : ""}>
                                <TableCell className="font-medium">{refill.refillName}</TableCell>
                                <TableCell>
                                    {editingId === refill.refillId ? (
                                        <Select 
                                            value={editingValues.kitchenLocationId || 'none'}
                                            onValueChange={(val) => setEditingValues(p => ({...p, kitchenLocationId: val === 'none' ? null : val}))}
                                        >
                                            <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">None</SelectItem>
                                                {kitchenLocations.map(kl => <SelectItem key={kl.id} value={kl.id}>{kl.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Badge variant="outline">{refill.kitchenLocationName || "N/A"}</Badge>
                                    )}
                                </TableCell>
                                 <TableCell>
                                    {editingId === refill.refillId ? (
                                        <Input
                                            type="number"
                                            value={editingValues.sortOrder}
                                            onChange={(e) => setEditingValues(p => ({...p, sortOrder: Number(e.target.value)}))}
                                            className="w-20 h-8"
                                        />
                                    ) : (
                                        refill.sortOrder
                                    )}
                                </TableCell>
                                <TableCell>
                                     <Switch 
                                        checked={refill.isEnabled}
                                        onCheckedChange={() => handleToggleEnabled(refill.refillId, refill.isEnabled)}
                                    />
                                </TableCell>
                                <TableCell className="text-right">
                                    {editingId === refill.refillId ? (
                                        <>
                                            <Button size="sm" onClick={() => handleSave(refill.refillId)}><Save className="mr-2"/>Save</Button>
                                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                                        </>
                                    ) : (
                                        <Button variant="ghost" size="icon" onClick={() => handleEdit(refill as StoreRefill)}>
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
