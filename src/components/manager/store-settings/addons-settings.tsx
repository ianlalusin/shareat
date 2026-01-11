
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, setDoc, updateDoc, serverTimestamp, orderBy, deleteDoc } from "firebase/firestore";
import { Loader, Edit, Power, PowerOff, PlusCircle, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { StoreAddonEditDialog } from "@/components/manager/store-settings/StoreAddonEditDialog";
import Image from "next/image";
import type { Store, InventoryItem, KitchenLocation, StoreAddon } from "@/lib/types";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getDisplayName } from "@/lib/products/variants";

export function AddonsSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();
    const { confirm, Dialog } = useConfirmDialog();

    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [storeAddons, setStoreAddons] = useState<StoreAddon[]>([]);
    const [kitchenLocations, setKitchenLocations] = useState<KitchenLocation[]>([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedAddon, setSelectedAddon] = useState<StoreAddon | null>(null);

    useEffect(() => {
        if (!store?.id) {
            setIsLoading(false);
            return;
        }

        const unsubInventory = onSnapshot(
            query(collection(db, "stores", store.id, "inventory"), where("isActive", "==", true)),
            (snap) => setInventory(snap.docs.map(d => d.data() as InventoryItem))
        );

        const unsubStoreAddons = onSnapshot(
            query(collection(db, "stores", store.id, "storeAddons"), orderBy("sortOrder", "asc")),
            (snap) => setStoreAddons(snap.docs.map(d => ({id: d.id, ...d.data()} as StoreAddon)))
        );

        const unsubKitchenLocations = onSnapshot(
            query(collection(db, "stores", store.id, "kitchenLocations"), where("isActive", "==", true)),
            (snapshot) => setKitchenLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KitchenLocation)))
        );

        setIsLoading(false);
        
        return () => { unsubInventory(); unsubStoreAddons(); unsubKitchenLocations(); }
    }, [store?.id]);

    const addonsWithDetails = useMemo(() => {
        const inventoryMap = new Map(inventory.map(i => [i.id, i]));
        
        return storeAddons.filter(addon => !(addon as any).isArchived).map(addon => {
            const invItem = inventoryMap.get(addon.id);
            return {
                ...addon,
                name: invItem ? getDisplayName(invItem) : addon.name,
                category: invItem?.subCategory || addon.category,
                imageUrl: invItem?.imageUrl,
            }
        });
    }, [storeAddons, inventory]);
    
     const availableInventoryItems = useMemo(() => {
        const storeAddonIds = new Set(storeAddons.map(p => p.id));
        return inventory.filter(p => !storeAddonIds.has(p.id));
    }, [inventory, storeAddons]);

    const handleToggleEnabled = async (addon: StoreAddon) => {
        if (!appUser) return;
        const newStatus = !addon.isEnabled;
        if (!(await confirm({ title: `${newStatus ? 'Enable' : 'Disable'} ${addon.name}?` }))) return;

        const docRef = doc(db, "stores", store.id, "storeAddons", addon.id);
        try {
            await updateDoc(docRef, { isEnabled: newStatus, updatedAt: serverTimestamp() });
            toast({ title: "Status Updated" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Update Failed", description: error.message });
        }
    };
    
    const handleSaveSettings = async (addonId: string, data: Partial<StoreAddon>) => {
        if (!appUser) return;
        
        const docRef = doc(db, "stores", store.id, "storeAddons", addonId);
        try {
            await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
            toast({ title: "Add-on Settings Updated" });
            setEditDialogOpen(false);
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Update Failed", description: error.message });
        }
    }

    const handleAddAddon = async (invItem: InventoryItem) => {
        if (!appUser) return;
        const docRef = doc(db, "stores", store.id, "storeAddons", invItem.id);
        
        try {
            await setDoc(docRef, {
                id: invItem.id,
                name: getDisplayName(invItem),
                price: invItem.sellingPrice,
                isEnabled: true,
                isArchived: false,
                sortOrder: 1000,
                category: invItem.subCategory || "Uncategorized",
                kitchenLocationId: null,
                kitchenLocationName: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            toast({ title: "Add-on Added" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Failed to Add", description: error.message });
        }
    };
    
    const handleArchive = async (addon: StoreAddon) => {
        if (!appUser) return;
        if (!(await confirm({
            title: `Archive ${addon.name}?`,
            description: "This removes it from the list. It can be re-added from inventory.",
            confirmText: "Yes, Archive",
            destructive: true,
        }))) return;

        const docRef = doc(db, "stores", store.id, "storeAddons", addon.id);
        try {
            // Using deleteDoc is simpler and cleaner than archiving in this context
            await deleteDoc(docRef);
            toast({ title: "Add-on Removed" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Failed to Remove", description: error.message });
        }
    };

    if (isLoading) return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;

    return (
        <div className="grid md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
                <CardHeader>
                    <CardTitle>Configured Add-ons</CardTitle>
                    <CardDescription>Manage sale price and kitchen assignment for items enabled as add-ons.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Product</TableHead>
                                <TableHead>Kitchen</TableHead>
                                <TableHead>Price</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {addonsWithDetails.map(addon => (
                                <TableRow key={addon.id}>
                                    <TableCell className="font-medium">{addon.name}</TableCell>
                                    <TableCell><Badge variant="outline">{addon.kitchenLocationName || 'N/A'}</Badge></TableCell>
                                    <TableCell>₱{addon.price.toFixed(2)}</TableCell>
                                    <TableCell><Badge variant={addon.isEnabled ? 'default' : 'secondary'}>{addon.isEnabled ? 'Enabled' : 'Disabled'}</Badge></TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="outline" size="sm" onClick={() => { setSelectedAddon(addon); setEditDialogOpen(true); }} className="mr-2"><Edit/></Button>
                                        <Button variant={addon.isEnabled ? 'secondary' : 'default'} size="sm" onClick={() => handleToggleEnabled(addon)} className="mr-2">
                                            {addon.isEnabled ? <PowerOff/> : <Power/>}
                                        </Button>
                                        <Button variant="destructive" size="sm" onClick={() => handleArchive(addon)}><Trash2/></Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Add from Inventory</CardTitle>
                    <CardDescription>Enable items from your inventory to be sold as add-ons.</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-96">
                        {availableInventoryItems.length > 0 ? (
                            <div className="space-y-2">
                                {availableInventoryItems.map(item => (
                                    <div key={item.id} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-md">
                                        <div>
                                            <p className="font-medium">{getDisplayName(item)}</p>
                                            <p className="text-xs text-muted-foreground">₱{item.sellingPrice.toFixed(2)}</p>
                                        </div>
                                        <Button size="sm" variant="outline" onClick={() => handleAddAddon(item)}><PlusCircle /></Button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-center text-sm text-muted-foreground py-10">All inventory items have been added.</p>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
            
            {editDialogOpen && selectedAddon && (
                <StoreAddonEditDialog
                    isOpen={editDialogOpen}
                    onClose={() => setEditDialogOpen(false)}
                    addon={selectedAddon}
                    onSave={handleSaveSettings}
                    kitchenLocations={kitchenLocations}
                />
            )}
            {Dialog}
        </div>
    )
}
