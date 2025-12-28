
"use client";

import { useState, useEffect } from "react";
import { Store } from "@/app/admin/stores/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/firebase/client";
import { collection, onSnapshot, query, orderBy, doc, writeBatch, serverTimestamp, updateDoc, getDocs, getDoc } from "firebase/firestore";
import { Loader, PlusCircle, Save, Settings, Pencil, Power, PowerOff } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuthContext } from "@/context/auth-context";
import { logActivity } from "@/lib/firebase/activity-log";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

export type StoreTable = {
    id: string; // T1, T2 etc.
    code: string;
    tableNumber: string;
    displayName: string;
    isActive: boolean;
    status: 'available' | 'occupied' | 'reserved' | 'out_of_order';
    currentSessionId: string | null;
}

export function TablesSettings({ store }: { store: Store }) {
    const { appUser } = useAuthContext();
    const { toast } = useToast();
    const { confirm, Dialog } = useConfirmDialog();

    const [tables, setTables] = useState<StoreTable[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingTableId, setEditingTableId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const [startNum, setStartNum] = useState(1);
    const [endNum, setEndNum] = useState(30);
    const [isGenerating, setIsGenerating] = useState(false);

    useEffect(() => {
        const tablesRef = collection(db, "stores", store.id, "tables");
        const q = query(tablesRef, orderBy("tableNumber", "asc"));
        
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setTables(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as StoreTable)));
            setIsLoading(false);
        });
        
        return () => unsubscribe();
    }, [store.id]);

    const handleEditClick = (table: StoreTable) => {
        setEditingTableId(table.id);
        setEditingName(table.displayName);
    };

    const handleSaveName = async (tableId: string) => {
        if (!appUser) return;
        const docRef = doc(db, "stores", store.id, "tables", tableId);
        try {
            await updateDoc(docRef, { displayName: editingName, updatedAt: serverTimestamp() });
            await logActivity(appUser, "table_renamed", `Renamed table ${tableId} to ${editingName}`);
            toast({ title: "Table Renamed" });
        } catch(e: any) {
            toast({ variant: "destructive", title: "Save Failed", description: e.message });
        } finally {
            setEditingTableId(null);
        }
    };
    
    const handleToggleActive = async (table: StoreTable) => {
        if (!appUser) return;
        const newStatus = !table.isActive;
        const action = newStatus ? "Enable" : "Disable";
        
        if (!(await confirm({ title: `${action} ${table.displayName}?`, confirmText: `Yes, ${action}` }))) return;

        const docRef = doc(db, "stores", store.id, "tables", table.id);
        await updateDoc(docRef, { isActive: newStatus, updatedAt: serverTimestamp() });
        toast({ title: "Status Updated" });
        await logActivity(appUser, `table_${action.toLowerCase()}`, `${action}d table: ${table.displayName}`);
    };

    const handleGenerateTables = async () => {
        if (!appUser) return;
        if (endNum < startNum) {
            toast({variant: "destructive", title: "Invalid Range", description: "End number must be greater than start number."});
            return;
        }

        const confirmed = await confirm({
            title: `Generate tables ${startNum} to ${endNum}?`,
            description: "This will create or update tables. It will not affect the status of existing, occupied tables.",
            confirmText: "Yes, Generate"
        });
        if (!confirmed) return;

        setIsGenerating(true);
        toast({ title: "Generating Tables...", description: "Please wait." });
        const tablesRef = collection(db, "stores", store.id, "tables");
        
        // Fetch existing tables to avoid overwriting their live status
        const existingTablesSnap = await getDocs(tablesRef);
        const existingTables = new Map(existingTablesSnap.docs.map(d => [d.id, d.data()]));

        let batch = writeBatch(db);
        let batchCount = 0;

        for (let i = startNum; i <= endNum; i++) {
            const tableId = `T${i}`;
            const docRef = doc(db, "stores", store.id, "tables", tableId);
            const existing = existingTables.get(tableId);

            if (existing) {
                // If it exists, just ensure it's active but DON'T touch status or session
                 batch.update(docRef, { 
                    displayName: `Table ${i}`,
                    isActive: true, 
                    updatedAt: serverTimestamp() 
                });
            } else {
                // If it doesn't exist, create it from scratch
                batch.set(docRef, {
                    id: tableId,
                    code: tableId,
                    tableNumber: `${i}`,
                    displayName: `Table ${i}`,
                    isActive: true,
                    status: 'available',
                    currentSessionId: null,
                    storeId: store.id,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
            }
            batchCount++;
            if (batchCount >= 400) {
                await batch.commit();
                batch = writeBatch(db);
                batchCount = 0;
            }
        }
        
        try {
            if (batchCount > 0) await batch.commit();
            await logActivity(appUser, "tables_generated", `Generated tables from ${startNum} to ${endNum}`);
            toast({ title: "Tables Generated Successfully" });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Generation Failed", description: error.message });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <>
            <div className="grid md:grid-cols-3 gap-6 items-start">
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Tables</CardTitle>
                        <CardDescription>Manage seating tables for this store.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? <Loader className="animate-spin"/> : (
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Number</TableHead>
                                        <TableHead>Display Name</TableHead>
                                        <TableHead>Live Status</TableHead>
                                        <TableHead>Enabled</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {tables.map(table => (
                                        <TableRow key={table.id}>
                                            <TableCell className="font-medium">{table.tableNumber}</TableCell>
                                            <TableCell>
                                                {editingTableId === table.id ? (
                                                    <Input value={editingName} onChange={e => setEditingName(e.target.value)} />
                                                ) : (
                                                    table.displayName
                                                )}
                                            </TableCell>
                                            <TableCell><Badge variant={table.status === 'available' ? 'secondary' : 'default'} className="capitalize">{table.status}</Badge></TableCell>
                                            <TableCell><Badge variant={table.isActive ? 'default' : 'outline'}>{table.isActive ? "Yes" : "No"}</Badge></TableCell>
                                            <TableCell className="text-right">
                                                {editingTableId === table.id ? (
                                                    <Button size="sm" onClick={() => handleSaveName(table.id)}><Save className="mr-2"/>Save</Button>
                                                ) : (
                                                    <Button variant="ghost" size="icon" onClick={() => handleEditClick(table)}><Pencil className="h-4 w-4"/></Button>
                                                )}
                                                <Button variant="ghost" size="icon" onClick={() => handleToggleActive(table)}>
                                                    {table.isActive ? <PowerOff className="h-4 w-4 text-destructive"/> : <Power className="h-4 w-4"/>}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
                <Card>
                     <CardHeader>
                        <CardTitle>Tools</CardTitle>
                        <CardDescription>Bulk operations for tables.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Separator />
                        <div className="space-y-2">
                            <h4 className="font-medium">Generate Tables</h4>
                            <p className="text-sm text-muted-foreground">Quickly create a range of numbered tables.</p>
                             <div className="flex items-center gap-2">
                                <Input type="number" value={startNum} onChange={e => setStartNum(parseInt(e.target.value))} placeholder="Start"/>
                                <span>to</span>
                                <Input type="number" value={endNum} onChange={e => setEndNum(parseInt(e.target.value))} placeholder="End"/>
                             </div>
                             <Button className="w-full" onClick={handleGenerateTables} disabled={isGenerating}>
                                {isGenerating ? <Loader className="animate-spin mr-2"/> : <Settings className="mr-2" />}
                                Generate
                             </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
            {Dialog}
        </>
    );
}
