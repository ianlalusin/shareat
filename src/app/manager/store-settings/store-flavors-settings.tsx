
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { Loader, Edit, Save, PlusCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Flavor, Store, StoreFlavor } from "@/lib/types";

export function StoreFlavorsSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();

    const [globalFlavors, setGlobalFlavors] = useState<Flavor[]>([]);
    const [storeFlavors, setStoreFlavors] = useState<Map<string, StoreFlavor>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingSortOrder, setEditingSortOrder] = useState<number>(0);

    useEffect(() => {
        if (!store?.id) {
            setIsLoading(false);
            return;
        }

        const unsubGlobal = onSnapshot(query(collection(db, "flavors"), where("isActive", "==", true), where("isArchived", "==", false)), (snap) => {
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
    }, [store?.id]);

    const combinedFlavors = useMemo(() => {
        const enabledFlavors = new Set<string>();
        storeFlavors.forEach(sf => {
            if (sf.isEnabled) enabledFlavors.add(sf.flavorId);
        });

        return globalFlavors
            .filter(gF => enabledFlavors.has(gF.id))
            .map(gFlavor => {
                const sFlavor = storeFlavors.get(gFlavor.id);
                return {
                    flavorId: gFlavor.id,
                    flavorName: gFlavor.name,
                    isEnabled: sFlavor?.isEnabled ?? false,
                    sortOrder: sFlavor?.sortOrder ?? 1000,
                }
            }).sort((a,b) => a.sortOrder - b.sortOrder || a.flavorName.localeCompare(b.flavorName));
    }, [globalFlavors, storeFlavors]);

    const availableGlobalFlavors = useMemo(() => {
        const storeFlavorIds = new Set(Array.from(storeFlavors.values()).filter(sf => sf.isEnabled).map(sf => sf.flavorId));
        return globalFlavors.filter(f => !storeFlavorIds.has(f.id));
    }, [globalFlavors, storeFlavors]);

    const handleAddFlavor = async (flavor: Flavor) => {
        if (!appUser || !store) return;
        const docRef = doc(db, "stores", store.id, "storeFlavors", flavor.id);
        try {
            await setDoc(docRef, {
                flavorId: flavor.id,
                flavorName: flavor.name,
                isEnabled: true,
                sortOrder: 1000,
            }, { merge: true });
            toast({ title: "Flavor Added" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Add Failed", description: error.message });
        }
    };
    
    const handleToggleEnabled = async (flavorId: string) => {
        if (!appUser || !store) return;
        const sFlavor = storeFlavors.get(flavorId);
        const gFlavor = globalFlavors.find(f => f.id === flavorId);
        if (!gFlavor) return;

        const docRef = doc(db, "stores", store.id, "storeFlavors", flavorId);
        try {
            await setDoc(docRef, {
                flavorId: gFlavor.id,
                flavorName: gFlavor.name,
                isEnabled: !sFlavor?.isEnabled,
                sortOrder: sFlavor?.sortOrder ?? 1000,
            }, { merge: true });
            toast({ title: "Status Updated" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Update Failed", description: error.message });
        }
    };
    
    const handleSaveSortOrder = async (flavorId: string) => {
        if (!appUser || !store) return;
        const docRef = doc(db, "stores", store.id, "storeFlavors", flavorId);
        try {
             await updateDoc(docRef, { sortOrder: editingSortOrder });
            toast({ title: "Sort Order Saved" });
            setEditingId(null);
        } catch (error: any) {
             toast({ variant: 'destructive', title: "Save Failed", description: error.message });
        }
    };

    if (isLoading) return <Loader className="animate-spin" />;

    return (
         <div className="grid md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
                <CardHeader>
                    <CardTitle>Store Flavors</CardTitle>
                    <CardDescription>Manage which global flavors are available in this store.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Flavor</TableHead>
                                <TableHead>Sort Order</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {combinedFlavors.map(flavor => (
                                <TableRow key={flavor.flavorId}>
                                    <TableCell className="font-medium">{flavor.flavorName}</TableCell>
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
                                                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                                                <Button size="sm" onClick={() => handleSaveSortOrder(flavor.flavorId)}><Save className="mr-2"/>Save</Button>
                                            </>
                                        ) : (
                                            <>
                                            <Button variant="ghost" size="icon" onClick={() => {setEditingId(flavor.flavorId); setEditingSortOrder(flavor.sortOrder)}}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleToggleEnabled(flavor.flavorId)}>
                                                <PowerOff className="h-4 w-4 text-destructive" />
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
                    <CardTitle>Add from Global Flavors</CardTitle>
                    <CardDescription>Select global flavors to enable them in this store.</CardDescription>
                </CardHeader>
                <CardContent>
                     <ScrollArea className="h-96">
                        {availableGlobalFlavors.length > 0 ? (
                            <div className="space-y-2">
                                {availableGlobalFlavors.map(flavor => (
                                    <div key={flavor.id} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-md">
                                        <span className="font-medium">{flavor.name}</span>
                                        <Button size="sm" variant="outline" onClick={() => handleAddFlavor(flavor)}><PlusCircle /></Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-center text-sm text-muted-foreground p-4">All global flavors have been added.</p>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
