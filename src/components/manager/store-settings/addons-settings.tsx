
"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp, updateDoc, setDoc, getDoc, orderBy } from "firebase/firestore";
import { Loader, Edit, Power, PowerOff, MoreHorizontal, PlusCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { StoreAddonEditDialog } from "@/components/manager/store-settings/StoreAddonEditDialog";
import Image from "next/image";
import type { Store, InventoryItem, KitchenLocation, Product, StoreAddon } from "@/lib/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getDisplayName } from "@/lib/products/variants";

export function AddonsSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();

    const [allAddonProducts, setAllAddonProducts] = useState<Product[]>([]);
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

        // Get all GLOBAL products that are add-ons and are sellable SKUs
        const unsubInventory = onSnapshot(
            query(collection(db, "products"), where("category", "==", "Add-on"), where("isActive", "==", true), where("isSku", "==", true)), 
            (snap) => {
                 const list = snap.docs
                    .map(d => ({id: d.id, ...d.data()} as Product))
                    .filter(p => (p as any).isArchived !== true);
                setAllAddonProducts(list);
            }
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
                    name: getDisplayName(productData || addon),
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
    }, [store?.id]);

    const filteredStoreAddons = useMemo(() => {
        return storeAddons.filter(item => 
            (!showEnabledOnly || item.isEnabled) &&
            (item.name.toLowerCase().includes(search.toLowerCase()) || 
             (item.category || "").toLowerCase().includes(search.toLowerCase()))
        );
    }, [storeAddons, showEnabledOnly, search]);
    
    const availableGlobalAddons = useMemo(() => {
        const storeAddonIds = new Set(storeAddons.map(s => s.id));
        const available = allAddonProducts.filter(item => item.id && !storeAddonIds.has(item.id));
        
        const grouped: Record<string, { groupName: string; items: Product[] }> = {};
        available.forEach(p => {
            const groupId = p.groupId || p.id;
            const groupName = p.groupName || p.name;
            if (!grouped[groupId]) {
                grouped[groupId] = { groupName: groupName, items: [] };
            }
            grouped[groupId].items.push(p);
        });

        return Object.values(grouped).sort((a,b) => a.groupName.localeCompare(b.groupName));

    }, [allAddonProducts, storeAddons]);

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
    
    const handleAddAddon = async (product: Product) => {
        if (!appUser || !product.id) return;
        
        const addonId = product.id;
        const docRef = doc(db, "stores", store.id, "storeAddons", addonId);

        try {
            const newAddonData: StoreAddon = {
                id: addonId,
                name: getDisplayName(product),
                category: product.subCategory,
                uom: product.uom,
                price: 0, // Default price to 0
                isEnabled: true,
                isArchived: false,
                sortOrder: 1000,
                kitchenLocationId: null,
                kitchenLocationName: null,
                imageUrl: product.imageUrl ?? undefined,
            };

            await setDoc(docRef, {
                ...newAddonData,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            }, { merge: true });

            toast({ title: "Add-on Added", description: "Please confirm the price and kitchen location." });
            
            // Auto-open the dialog for the new addon
            setSelectedAddon(newAddonData);
            setEditDialogOpen(true);

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
                                    <TableCell className="font-medium flex items-center gap-2 py-1.5">
                                        <div className="w-8 h-8 rounded-md bg-muted relative flex-shrink-0">
                                        {item.imageUrl && (
                                            <Image src={item.imageUrl} alt={item.name} layout="fill" objectFit="cover" className="rounded-md" />
                                        )}
                                        </div>
                                        <span className="truncate">{item.name}</span>
                                    </TableCell>
                                    <TableCell className="py-1.5"><Badge variant="outline">{item.kitchenLocationName || 'N/A'}</Badge></TableCell>
                                    <TableCell className="py-1.5">₱{(item.price || 0).toFixed(2)}</TableCell>
                                    <TableCell className="py-1.5">
                                        <Badge variant={item.isEnabled ? 'default' : 'outline'}>
                                            {item.isEnabled ? "Enabled" : "Disabled"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right py-1.5">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon"><MoreHorizontal /></Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent>
                                                <DropdownMenuItem onSelect={() => { setSelectedAddon(item); setEditDialogOpen(true); }}>
                                                    <Edit className="mr-2 h-4 w-4" /> Edit
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onSelect={() => handleToggleEnabled(item)}>
                                                    {item.isEnabled ? <PowerOff className="mr-2 h-4 w-4 text-destructive" /> : <Power className="mr-2 h-4 w-4" />}
                                                    {item.isEnabled ? "Disable" : "Enable"}
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Add from Global Products</CardTitle>
                    <CardDescription>Add "Add-on" items from the global product library.</CardDescription>
                </CardHeader>
                <CardContent>
                     <ScrollArea className="h-96">
                        {availableGlobalAddons.length > 0 ? (
                             availableGlobalAddons.map(({ groupName, items }) => (
                                <div key={groupName} className="mb-2">
                                    <h4 className="font-semibold text-sm mb-1">{groupName}</h4>
                                    <div className="space-y-1 pl-2 border-l">
                                    {items.map(item => (
                                        <div key={item.id} className="flex items-center justify-between p-1 hover:bg-muted/50 rounded-md">
                                            <div>
                                                <p className="font-medium text-sm">{getDisplayName(item)}</p>
                                                <p className="text-xs text-muted-foreground">{item.subCategory}</p>
                                            </div>
                                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleAddAddon(item)}><PlusCircle size={16}/></Button>
                                        </div>
                                    ))}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-sm text-muted-foreground p-4">All "Add-on" products have been added to this store.</p>
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
