
"use client";

import { useState, useEffect } from "react";
import { Store } from "@/app/admin/stores/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, orderBy, doc, writeBatch, serverTimestamp, updateDoc } from "firebase/firestore";
import { Loader, PlusCircle, Power, PowerOff } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { logActivity } from "@/lib/firebase/activity-log";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { KitchenLocationEditDialog, type KitchenLocation } from "./kitchen-location-edit-dialog";

export function KitchenLocationsSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();
    const { confirm, Dialog } = useConfirmDialog();

    const [locations, setLocations] = useState<KitchenLocation[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingLocation, setEditingLocation] = useState<KitchenLocation | null>(null);

    useEffect(() => {
        const locationsRef = collection(db, "stores", store.id, "kitchenLocations");
        const q = query(locationsRef, orderBy("sortOrder", "asc"), orderBy("name", "asc"));
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as KitchenLocation)));
            setIsLoading(false);
        });
        
        return () => unsubscribe();
    }, [store.id]);

    const handleOpenDialog = (location: KitchenLocation | null = null) => {
        setEditingLocation(location);
        setIsDialogOpen(true);
    };
    
    const handleCloseDialog = () => {
        setEditingLocation(null);
        setIsDialogOpen(false);
    }

    const handleSave = async (data: Partial<Omit<KitchenLocation, 'id' | 'createdAt' | 'updatedAt'>>) => {
        if (!appUser) return;
        const maxSortOrder = locations.reduce((max, loc) => Math.max(max, loc.sortOrder || 0), 0);

        try {
            if (editingLocation) { // Update
                const docRef = doc(db, "stores", store.id, "kitchenLocations", editingLocation.id);
                await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
                toast({ title: "Location Updated" });
                await logActivity(appUser, "kitchen_location_updated", `Updated location: ${data.name}`);
            } else { // Create
                const newDocRef = doc(collection(db, "stores", store.id, "kitchenLocations"));
                await writeBatch(db).set(newDocRef, {
                    id: newDocRef.id,
                    name: data.name,
                    sortOrder: data.sortOrder ?? (maxSortOrder + 1),
                    isActive: data.isActive ?? true,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                }).commit();
                toast({ title: "Location Created" });
                await logActivity(appUser, "kitchen_location_created", `Created new location: ${data.name}`);
            }
            handleCloseDialog();
        } catch (error: any) {
            toast({ variant: "destructive", title: "Save Failed", description: error.message });
        }
    };
    
    const handleToggleActive = async (location: KitchenLocation) => {
        if (!appUser) return;
        const newStatus = !location.isActive;
        const action = newStatus ? "Activate" : "Deactivate";
        
        if (!(await confirm({ title: `${action} ${location.name}?`, confirmText: `Yes, ${action}` }))) return;

        const docRef = doc(db, "stores", store.id, "kitchenLocations", location.id);
        await updateDoc(docRef, { isActive: newStatus, updatedAt: serverTimestamp() });
        toast({ title: "Status Updated" });
        await logActivity(appUser, `kitchen_location_${action.toLowerCase()}`, `${action}d location: ${location.name}`);
    };

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Kitchen Locations</CardTitle>
                    <CardDescription>Manage the kitchen stations or locations where orders are prepared.</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? <Loader className="animate-spin"/> : (
                        <>
                        <div className="flex justify-end mb-4">
                            <Button onClick={() => handleOpenDialog()}>
                                <PlusCircle className="mr-2"/> New Location
                            </Button>
                        </div>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Sort Order</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {locations.map(loc => (
                                    <TableRow key={loc.id}>
                                        <TableCell className="font-medium">{loc.name}</TableCell>
                                        <TableCell>{loc.sortOrder}</TableCell>
                                        <TableCell><Badge variant={loc.isActive ? "default" : "outline"}>{loc.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="outline" size="sm" onClick={() => handleOpenDialog(loc)} className="mr-2">Edit</Button>
                                            <Button variant={loc.isActive ? "destructive" : "default"} size="sm" onClick={() => handleToggleActive(loc)}>
                                                {loc.isActive ? <PowerOff/> : <Power/>}
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </>
                    )}
                </CardContent>
            </Card>
            {isDialogOpen && (
                 <KitchenLocationEditDialog 
                    isOpen={isDialogOpen}
                    onClose={handleCloseDialog}
                    onSave={handleSave}
                    item={editingLocation}
                 />
            )}
            {Dialog}
        </>
    );
}
