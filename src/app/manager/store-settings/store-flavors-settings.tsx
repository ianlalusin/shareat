
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { Loader2, Edit, Save, PlusCircle, RefreshCw } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Flavor, Store, StoreFlavor } from "@/lib/types";

function coerceStoreFlavor(d: QueryDocumentSnapshot<DocumentData>): StoreFlavor {
  const data = d.data() ?? {};
  return {
    flavorId: (data.flavorId as string) ?? d.id,
    flavorName: (data.flavorName as string) ?? (data.name as string) ?? "",
    isEnabled: typeof data.isEnabled === "boolean" ? data.isEnabled : true,
    sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 1000,
  };
}

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

        const unsubGlobal = onSnapshot(
            query(collection(db, "flavors"), where("isActive", "==", true)), 
            (snap) => {
                const list = snap.docs
                    .map(d => ({ id: d.id, ...d.data() } as Flavor))
                    .filter(f => (f as any).isArchived !== true);
                setGlobalFlavors(list);
            },
            (err) => {
                console.error("flavors query failed", err);
                toast({ variant: "destructive", title: "Failed to load global flavors", description: err.message });
            }
        );

        const unsubStore = onSnapshot(collection(db, "stores", store.id, "storeFlavors"), (snap) => {
            const map = new Map<string, StoreFlavor>();
            snap.forEach((d) => {
                map.set(d.id, coerceStoreFlavor(d)); // key = doc.id (same as global flavor id)
            });
            setStoreFlavors(map);
        });

        setIsLoading(false);
        return () => {
            unsubGlobal();
            unsubStore();
        }
    }, [store?.id, toast]);

    const combinedFlavors = useMemo(() => {
        return Array.from(storeFlavors.values())
            .map(sFlavor => {
                return {
                    ...sFlavor,
                    flavorName: sFlavor.flavorName,
                    isEnabled: sFlavor.isEnabled,
                    sortOrder: sFlavor.sortOrder,
                }
            }).sort((a,b) => a.sortOrder - b.sortOrder || a.flavorName.localeCompare(b.flavorName));
    }, [storeFlavors]);

    const availableGlobalFlavors = useMemo(() => {
        const storeFlavorIds = new Set(Array.from(storeFlavors.keys()));
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
    
    const handleToggleEnabled = async (flavor: StoreFlavor) => {
        if (!appUser || !store) return;
        const newStatus = !flavor.isEnabled;

        const docRef = doc(db, "stores", store.id, "storeFlavors", flavor.flavorId);
        try {
            await updateDoc(docRef, { isEnabled: newStatus });
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

    if (isLoading) return <Loader2 className="animate-spin" />;

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
                                <TableHead>Enabled</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {combinedFlavors.map(flavor => (
                                <TableRow key={flavor.flavorId} className={!flavor.isEnabled ? "text-muted-foreground" : ""}>
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
                                    <TableCell>
                                        <Switch 
                                            checked={flavor.isEnabled}
                                            onCheckedChange={() => handleToggleEnabled(flavor)}
                                        />
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
