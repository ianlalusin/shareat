
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { Loader2, Edit, Save, PlusCircle, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Refill, Store, StoreRefill, KitchenLocation } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

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
        if (!store?.id) {
            setIsLoading(false);
            setGlobalRefills([]);
            setStoreRefills(new Map());
            setKitchenLocations([]);
            return;
        }

        const unsubGlobal = onSnapshot(
            query(
                collection(db, "refills"), 
                where("isActive", "==", true)
            ), 
            (snap) => {
                const list = snap.docs
                    .map((d) => ({ id: d.id, ...(d.data() as any) } as Refill))
                    .filter((p) => (p as any).isArchived !== true);
                list.sort((a, b) => a.name.localeCompare(b.name));
                setGlobalRefills(list);
            },
            (err) => {
                console.error("refills query failed", err);
                toast({ variant: "destructive", title: "Failed to load global refills" });
                setGlobalRefills([]);
            }
        );

        const unsubStore = onSnapshot(collection(db, "stores", store.id, "storeRefills"), (snap) => {
            const map = new Map<string, StoreRefill>();
            snap.forEach(doc => map.set(doc.id, {id: doc.id, ...doc.data()} as StoreRefill));
            setStoreRefills(map);
        });

        const unsubKitchen = onSnapshot(query(collection(db, "stores", store.id, "kitchenLocations"), where("isActive", "==", true)), (snap) => {
            setKitchenLocations(snap.docs.map(d => d.data() as KitchenLocation));
        });

        Promise.all([getDocs(query(collection(db, "refills"))), getDocs(collection(db, "stores", store.id, "storeRefills"))]).then(() => {
            setIsLoading(false);
        });
        
        return () => { unsubGlobal(); unsubStore(); unsubKitchen(); }
    }, [store?.id, toast]);

    const combinedRefills = useMemo(() => {
        return Array.from(storeRefills.values())
            .map(sRefill => {
                return {
                    ...sRefill,
                    refillName: sRefill.refillName,
                    isEnabled: sRefill.isEnabled,
                    sortOrder: sRefill.sortOrder,
                    kitchenLocationId: sRefill.kitchenLocationId || null,
                    kitchenLocationName: sRefill.kitchenLocationName || null,
                }
            }).sort((a,b) => a.sortOrder - b.sortOrder || a.refillName.localeCompare(b.refillName));
    }, [storeRefills]);

     const availableGlobalRefills = useMemo(() => {
        return globalRefills.filter(f => !storeRefills.has(f.id));
    }, [globalRefills, storeRefills]);
    
    const handleSync = async () => {
        if (!appUser || !store) return;
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
            } else {
                toast({ title: "Already Up-to-Date", description: "No new global refills to add." });
            }
        } catch (error: any) {
             toast({ variant: 'destructive', title: "Sync Failed", description: error.message });
        } finally {
            setIsSyncing(false);
        }
    }

    const handleAddRefill = async (refill: Refill) => {
        if (!appUser || !store) return;
        const docRef = doc(db, "stores", store.id, "storeRefills", refill.id);
        try {
            await setDoc(docRef, {
                refillId: refill.id,
                refillName: refill.name,
                isEnabled: true,
                sortOrder: 1000,
                kitchenLocationId: null,
                kitchenLocationName: null,
            }, { merge: true });
            toast({ title: "Refill Added" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Add Failed", description: error.message });
        }
    };
    
    const handleToggleEnabled = async (refill: StoreRefill) => {
        if (!appUser || !store) return;
        const newStatus = !refill.isEnabled;

        const docRef = doc(db, "stores", store.id, "storeRefills", refill.refillId);
        try {
            await updateDoc(docRef, { 
                isEnabled: newStatus,
            });
            toast({ title: "Status Updated" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Update Failed", description: error.message });
        }
    };
    
    const handleEdit = (refill: any) => {
        setEditingId(refill.refillId);
        setEditingValues({
            sortOrder: refill.sortOrder,
            kitchenLocationId: refill.kitchenLocationId,
        });
    }

    const handleSave = async (refillId: string) => {
        if (!appUser || !store) return;
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

    if (isLoading) return <Loader2 className="animate-spin" />;

    return (
        <div className="grid md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Store Refills</CardTitle>
                            <CardDescription>Manage which global refills are available in this store.</CardDescription>
                        </div>
                        <Button onClick={handleSync} disabled={isSyncing}>
                            {isSyncing ? <Loader2 className="animate-spin mr-2"/> : <RefreshCw className="mr-2"/>}
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
                                            onCheckedChange={() => handleToggleEnabled(refill as any)}
                                        />
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {editingId === refill.refillId ? (
                                            <>
                                                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                                                <Button size="sm" onClick={() => handleSave(refill.refillId)}><Save className="mr-2"/>Save</Button>
                                            </>
                                        ) : (
                                            <>
                                            <Button variant="ghost" size="icon" onClick={() => handleEdit(refill as StoreRefill)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            </>
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
                    <CardTitle>Add from Global Refills</CardTitle>
                    <CardDescription>Select global refills to enable them in this store.</CardDescription>
                </CardHeader>
                <CardContent>
                     <ScrollArea className="h-96">
                        {availableGlobalRefills.length > 0 ? (
                            <div className="space-y-2">
                                {availableGlobalRefills.map(refill => (
                                    <div key={refill.id} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-md">
                                        <span className="font-medium">{refill.name}</span>
                                        <Button size="sm" variant="outline" onClick={() => handleAddRefill(refill)}><PlusCircle /></Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-center text-sm text-muted-foreground p-4">All global refills have been added.</p>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
