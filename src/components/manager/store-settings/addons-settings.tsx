
"use client";

import { useState, useEffect, useMemo } from "react";
import { Store } from "@/app/admin/stores/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, updateDoc, setDoc, getDoc, orderBy } from "firebase/firestore";
import { Loader, Edit, Power, PowerOff } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { logActivity } from "@/lib/firebase/activity-log";
import { InventoryItem } from "@/app/manager/inventory/page";
import { StoreAddonEditDialog } from "./StoreAddonEditDialog";
import { KitchenLocation } from "./kitchen-locations-settings";
import Image from "next/image";
import { Product } from "@/app/admin/menu/products/page";

export type StoreAddon = {
    id: string; // The document ID, which is the Product ID
    name: string; // Denormalized name
    price: number;
    isEnabled: boolean;
    sortOrder: number;
    isArchived: boolean;
    category?: string;
    uom?: string;
    kitchenLocationId?: string | null;
    kitchenLocationName?: string | null;
    imageUrl?: string;
};

export function AddonsSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();

    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
    const [storeAddons, setStoreAddons] = useState<StoreAddon[]>([]);
    const [kitchenLocations, setKitchenLocations] = useState<KitchenLocation[]>([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [showEnabledOnly, setShowEnabledOnly] = useState(true);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [selectedAddon, setSelectedAddon] = useState<StoreAddon | null>(null);

    useEffect(() => {
        const unsubInventory = onSnapshot(
            query(collection(db, "stores", store.id, "inventory"), where("category", "==", "Add-on")), 
            (snap) => setInventoryItems(snap.docs.map(d => ({id: d.id, ...d.data()} as InventoryItem)))
        );

        const storeAddonsQuery = query(
            collection(db, "stores", store.id, "storeAddons"),
            where("isArchived", "==", false),
            orderBy("sortOrder", "asc"),
            orderBy("name", "asc")
        );
        const unsubStoreAddons = onSnapshot(storeAddonsQuery, async (snap) => {
            const addonsData = snap.docs.map(d => ({id: d.id, ...d.data()} as StoreAddon));

            const addonsWithDetails = await Promise.all(addonsData.map(async (addon) => {
                let productData: Product | null = null;
                try {
                    const productDoc = await getDoc(doc(db, "products", addon.id));
                    if (productDoc.exists()) {
                        productData = productDoc.data() as Product;
                    }
                } catch (e) {
                    console.error("Error fetching product image URL for addon:", addon.id, e);
                }
                return {
                    ...addon,
                    name: productData?.name || addon.name,
                    category: productData?.subCategory || addon.category,
                    imageUrl: productData?.imageUrl || addon.imageUrl,
                };
            }));
            
            setStoreAddons(addonsWithDetails);
        });

        const unsubKitchenLocations = onSnapshot(query(collection(db, "stores", store.id, "kitchenLocations"), where("isActive", "==", true)), (snapshot) => {
            setKitchenLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KitchenLocation)));
        });

        Promise.all([unsubInventory, unsubStoreAddons, unsubKitchenLocations]).then(() => setIsLoading(false));
        
        return () => {
            unsubInventory();
            unsubStoreAddons();
            unsubKitchenLocations();
        }
    }, [store.id]);

    const filteredStoreAddons = useMemo(() => {
        return storeAddons.filter(item => 
            (!showEnabledOnly || item.isEnabled) &&
            (item.name.toLowerCase().includes(search.toLowerCase()) || 
             (item.category || "").toLowerCase().includes(search.toLowerCase()))
        );
    }, [storeAddons, showEnabledOnly, search]);
    
    const availableInventoryItems = useMemo(() => {
        const storeAddonIds = new Set(storeAddons.map(s => s.id));
        return inventoryItems
            .filter(item => !storeAddonIds.has(item.productId));
    }, [inventoryItems, storeAddons]);

    const handleToggleEnabled = async (addon: StoreAddon) => {
        if (!appUser) return;
        const newStatus = !addon.isEnabled;
        
        const docRef = doc(db, "stores", store.id, "storeAddons", addon.id);
        try {
            await updateDoc(docRef, { isEnabled: newStatus, updatedAt: serverTimestamp() });
            toast({ title: "Status Updated" });
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Update Failed", description: error.message });
        }
    };
    
    const handleAddAddon = async (inventoryItem: InventoryItem) => {
        if (!appUser) return;
        
        const addonId = inventoryItem.productId;
        const docRef = doc(db, "stores", store.id, "storeAddons", addonId);

        try {
            const productDoc = await getDoc(doc(db, "products", addonId));
            const imageUrl = productDoc.exists() ? productDoc.data().imageUrl : null;
            
            await setDoc(docRef, {
                id: addonId,
                name: inventoryItem.name,
                category: inventoryItem.subCategory,
                uom: inventoryItem.uom,
                price: inventoryItem.sellingPrice || 0,
                isEnabled: true,
                isArchived: false,
                sortOrder: 1000,
                kitchenLocationId: null,
                kitchenLocationName: null,
                imageUrl: imageUrl,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });
            toast({ title: "Add-on Added", description: "Please confirm the price and kitchen location." });
            await logActivity(appUser, 'store_addon_added', `Added addon ID ${addonId} to store.`);
        } catch (error: any) {
            toast({ variant: "destructive", title: "Add Failed", description: error.message });
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

    if (isLoading) return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;

    return (
        <div className="grid md:grid-cols-3 gap-6">
            <Card className="md:col-span-2">
                <CardHeader>
                    <CardTitle>Store Add-ons</CardTitle>
                    <CardDescription>Manage prices and availability for add-ons in this store.</CardDescription>
                    <div className="flex justify-between items-center pt-2">
                        <Input 
                            placeholder="Search by name or category..." 
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="max-w-sm"
                        />
                        <div className="flex items-center space-x-2">
                            <Checkbox 
                                id="show-enabled" 
                                checked={showEnabledOnly}
                                onCheckedChange={(checked) => setShowEnabledOnly(checked as boolean)}
                            />
                            <label htmlFor="show-enabled" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                Enabled Only
                            </label>
                        </div>
                    </div>
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
                            {filteredStoreAddons.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell className="font-medium flex items-center gap-2">
                                        <div className="w-10 h-10 rounded-md bg-muted relative">
                                        {item.imageUrl && (
                                            <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" className="rounded-md" />
                                        )}
                                        </div>
                                        {item.name}
                                    </TableCell>
                                    <TableCell><Badge variant="outline">{item.kitchenLocationName || 'N/A'}</Badge></TableCell>
                                    <TableCell>₱{(item.price || 0).toFixed(2)}</TableCell>
                                    <TableCell>
                                        <Badge variant={item.isEnabled ? 'default' : 'outline'}>
                                            {item.isEnabled ? "Enabled" : "Disabled"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => { setSelectedAddon(item); setEditDialogOpen(true); }}>
                                            <Edit className="h-4 w-4"/>
                                        </Button>
                                        <Button variant="ghost" size="icon" onClick={() => handleToggleEnabled(item)}>
                                            {item.isEnabled ? <PowerOff className="h-4 w-4 text-destructive" /> : <Power className="h-4 w-4" />}
                                        </Button>
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
                    <CardDescription>Add "Add-on" items from this store's inventory.</CardDescription>
                </CardHeader>
                <CardContent>
                     <ScrollArea className="h-96">
                        {availableInventoryItems.length > 0 ? availableInventoryItems.map(item => (
                            <div key={item.id} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded-md">
                                <div>
                                    <p className="font-medium">{item.name}</p>
                                    <p className="text-xs text-muted-foreground">{item.subCategory}</p>
                                </div>
                                <Button size="sm" onClick={() => handleAddAddon(item)}>Add</Button>
                            </div>
                        )) : (
                            <p className="text-center text-sm text-muted-foreground p-4">All "Add-on" items from your inventory have been added.</p>
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
        </div>
    )
}
