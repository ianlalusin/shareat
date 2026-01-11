
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, setDoc, updateDoc, serverTimestamp, orderBy } from "firebase/firestore";
import { Loader, Edit, Power, PowerOff, MoreHorizontal } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { StoreAddonEditDialog } from "@/components/manager/store-settings/StoreAddonEditDialog";
import Image from "next/image";
import type { Store, InventoryItem, KitchenLocation, StoreAddon } from "@/lib/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getDisplayName } from "@/lib/products/variants";

export function AddonsSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();

    const [inventory, setInventory] = useState<InventoryItem[]>([]);
    const [storeAddons, setStoreAddons] = useState<StoreAddon[]>([]);
    const [kitchenLocations, setKitchenLocations] = useState<KitchenLocation[]>([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [showEnabledOnly, setShowEnabledOnly] = useState(true);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedAddon, setSelectedAddon] = useState<StoreAddon | null>(null);

    useEffect(() => {
        if (!store?.id) {
            setIsLoading(false);
            return;
        }

        const unsubInventory = onSnapshot(
            query(collection(db, "stores", store.id, "inventory"), where("category", "==", "Add-on")),
            (snap) => setInventory(snap.docs.map(d => d.data() as InventoryItem))
        );

        const unsubStoreAddons = onSnapshot(collection(db, "stores", store.id, "storeAddons"), async (snap) => {
            const addonsData = snap.docs.map(d => ({id: d.id, ...d.data()} as StoreAddon));
            setStoreAddons(addonsData);
        });

        const unsubKitchenLocations = onSnapshot(query(collection(db, "stores", store.id, "kitchenLocations"), where("isActive", "==", true)), (snapshot) => {
            setKitchenLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KitchenLocation)));
        });

        setIsLoading(false);
        
        return () => { unsubInventory(); unsubStoreAddons(); unsubKitchenLocations(); }
    }, [store?.id]);

    const enrichedAddons = useMemo(() => {
        const inventoryMap = new Map(inventory.map(i => [i.id, i]));
        
        return storeAddons.map(addon => {
            const invItem = inventoryMap.get(addon.id);
            return {
                ...addon,
                name: invItem ? getDisplayName(invItem) : addon.name,
                category: invItem?.subCategory || addon.category,
                imageUrl: invItem?.imageUrl, // Always prefer inventory (product) image
            }
        });
    }, [storeAddons, inventory]);

    const filteredStoreAddons = useMemo(() => {
        return enrichedAddons.filter(item => 
            (!showEnabledOnly || item.isEnabled) &&
            (item.name.toLowerCase().includes(search.toLowerCase()) || 
             (item.category || "").toLowerCase().includes(search.toLowerCase()))
        );
    }, [enrichedAddons, showEnabledOnly, search]);

    const handleToggleEnabled = async (addon: StoreAddon) => {
        if (!appUser) return;
        const newStatus = !addon.isEnabled;
        
        const docRef = doc(db, "stores", store.id, "storeAddons", addon.id);
        try {
            await updateDoc(docRef, { isEnabled: newStatus, updatedAt: serverTimestamp() });
            
            // If we are enabling an item that doesn't have a corresponding storeAddon document yet, create it.
            if (newStatus && !storeAddons.some(sa => sa.id === addon.id)) {
                 const invItem = inventory.find(i => i.id === addon.id);
                 if (invItem) {
                    await setDoc(docRef, {
                        id: invItem.id,
                        name: getDisplayName(invItem),
                        category: invItem.subCategory,
                        price: invItem.sellingPrice, // Default to inventory selling price
                        isEnabled: true,
                        isArchived: false,
                        sortOrder: 1000,
                        kitchenLocationId: null,
                        kitchenLocationName: null,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    }, { merge: true });
                 }
            }

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
    
    const inventoryItemsWithAddonStatus = useMemo(() => {
        const storeAddonMap = new Map(storeAddons.map(sa => [sa.id, sa]));
        return inventory
            .filter(item => item.category === "Add-on")
            .map(item => ({
                ...item,
                isEnabledAsAddon: storeAddonMap.get(item.id)?.isEnabled || false,
                storeAddonData: storeAddonMap.get(item.id),
            }))
            .sort((a,b) => getDisplayName(a).localeCompare(getDisplayName(b)));
    }, [inventory, storeAddons]);

    if (isLoading) return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Store Add-ons</CardTitle>
                <CardDescription>Manage prices and availability for add-ons from your inventory.</CardDescription>
                <div className="flex justify-between items-center pt-2">
                    <Input 
                        placeholder="Search by name or category..." 
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="max-w-sm"
                    />
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>Kitchen</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead>Enabled as Add-on</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {inventoryItemsWithAddonStatus.filter(item => getDisplayName(item).toLowerCase().includes(search.toLowerCase())).map(item => (
                            <TableRow key={item.id}>
                                <TableCell className="font-medium flex items-center gap-2 py-1.5">
                                    <div className="w-8 h-8 rounded-md bg-muted relative flex-shrink-0">
                                    {item.imageUrl && (
                                        <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" className="rounded-md" />
                                    )}
                                    </div>
                                    <div>
                                        <span className="truncate font-medium">{getDisplayName(item)}</span>
                                        <p className="text-xs text-muted-foreground">{item.subCategory}</p>
                                    </div>
                                </TableCell>
                                <TableCell className="py-1.5"><Badge variant="outline">{item.storeAddonData?.kitchenLocationName || 'N/A'}</Badge></TableCell>
                                <TableCell className="py-1.5">₱{(item.storeAddonData?.price ?? item.sellingPrice).toFixed(2)}</TableCell>
                                <TableCell className="py-1.5">
                                    <Switch
                                        checked={item.isEnabledAsAddon}
                                        onCheckedChange={() => handleToggleEnabled(item.storeAddonData || { id: item.id, isEnabled: false } as any)}
                                    />
                                </TableCell>
                                <TableCell className="text-right py-1.5">
                                     <Button 
                                        variant="outline"
                                        size="sm"
                                        disabled={!item.isEnabledAsAddon}
                                        onClick={() => { setSelectedAddon(item.storeAddonData || {id: item.id, name: getDisplayName(item), price: item.sellingPrice} as any); setEditDialogOpen(true); }}
                                    >
                                        <Edit className="mr-2 h-4 w-4" /> Edit
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
             {editDialogOpen && selectedAddon && (
                <StoreAddonEditDialog
                    isOpen={editDialogOpen}
                    onClose={() => setEditDialogOpen(false)}
                    addon={selectedAddon}
                    onSave={handleSaveSettings}
                    kitchenLocations={kitchenLocations}
                />
            )}
        </Card>
    )
}
