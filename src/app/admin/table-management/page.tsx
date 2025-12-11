

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { PlusCircle, Edit, Trash2, Wrench } from 'lucide-react';
import { useFirestore } from '@/firebase';
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  query,
  where,
  writeBatch,
  getDocs,
  getDoc,
} from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { Table, Store, Order } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useSuccessModal } from '@/store/use-success-modal';
import { useToast } from '@/hooks/use-toast';

const initialTableState: Omit<Table, 'id' | 'storeId'> = {
  tableName: '',
  status: 'Available',
  activeOrderId: '',
  resetCounter: 0,
  location: '',
};

export default function TableManagementPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [formData, setFormData] = useState(initialTableState);
  const firestore = useFirestore();
  const { selectedStoreId } = useStoreSelector();
  const { openSuccessModal } = useSuccessModal();
  const { toast } = useToast();

  useEffect(() => {
    if (firestore && selectedStoreId) {
      const q = query(collection(firestore, 'tables'), where('storeId', '==', selectedStoreId));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const tablesData = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as Table[];
        setTables(tablesData.sort((a, b) => a.tableName.localeCompare(b.tableName, undefined, { numeric: true })));
      });

      const storeDocRef = doc(firestore, 'stores', selectedStoreId);
      const storeUnsubscribe = onSnapshot(storeDocRef, (docSnap) => {
        if(docSnap.exists()){
          setCurrentStore({id: docSnap.id, ...docSnap.data()} as Store);
        } else {
          setCurrentStore(null);
        }
      });

      return () => {
        unsubscribe();
        storeUnsubscribe();
      }
    } else {
      setTables([]);
      setCurrentStore(null);
    }
  }, [firestore, selectedStoreId]);

  const handleModalOpenChange = (open: boolean) => {
    setIsModalOpen(open);
    if (!open) {
      setEditingTable(null);
      setFormData(initialTableState);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value as any }));
  };
  
  const handleOpenModal = (table: Table | null) => {
    if (!selectedStoreId) {
      toast({
        variant: 'destructive',
        title: 'No Store Selected',
        description: 'Please select a store first.',
      });
      return;
    }
    if (table) {
      setFormData({
        tableName: table.tableName,
        status: table.status,
        activeOrderId: table.activeOrderId || '',
        resetCounter: table.resetCounter || 0,
        location: table.location || '',
      });
      setEditingTable(table);
    } else {
      setFormData(initialTableState);
      setEditingTable(null);
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !selectedStoreId) return;
    
    if (currentStore && currentStore.tableLocations.length > 0 && !formData.location) {
      toast({
        variant: 'destructive',
        title: 'Location Required',
        description: 'Please select a table location.',
      });
      return;
    }

    const dataToSave = {
      tableName: formData.tableName,
      status: formData.status,
      activeOrderId: formData.activeOrderId,
      resetCounter: formData.resetCounter,
      location: formData.location,
      storeId: selectedStoreId,
    };

    try {
      if (editingTable) {
        const tableRef = doc(firestore, 'tables', editingTable.id);
        await updateDoc(tableRef, {
            tableName: dataToSave.tableName,
            status: dataToSave.status,
            location: dataToSave.location,
        });
      } else {
        await addDoc(collection(firestore, 'tables'), {
            ...dataToSave,
            activeOrderId: '',
            resetCounter: 0
        });
      }
      handleModalOpenChange(false);
      openSuccessModal();
    } catch (error) {
       toast({
        variant: 'destructive',
        title: 'Save Failed',
        description: 'There was a problem saving the table.',
      });
    }
  };
  
  const handleDelete = async (tableId: string) => {
    if (!firestore) return;
    try {
      await deleteDoc(doc(firestore, 'tables', tableId));
      openSuccessModal();
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Delete Failed',
        description: 'Could not delete the table.',
      });
    }
  };

  const resetAllCounters = async () => {
    if (!firestore || tables.length === 0) return;
    if (window.confirm('Are you sure you want to reset the counter for ALL tables in this store?')) {
      const batch = writeBatch(firestore);
      tables.forEach(table => {
        const tableRef = doc(firestore, 'tables', table.id);
        batch.update(tableRef, { resetCounter: 0 });
      });
      try {
        await batch.commit();
        openSuccessModal();
      } catch (error) {
        toast({
            variant: 'destructive',
            title: 'Reset Failed',
            description: 'Could not reset all counters.',
        });
      }
    }
  };
  
  const handleResetStuckTables = async () => {
    if (!firestore || !selectedStoreId) return;
    if (!window.confirm('This will check all occupied tables and reset any that are stuck or linked to inactive orders. Continue?')) return;

    toast({ title: 'Starting Cleanup...', description: 'Checking all occupied tables for inconsistencies.' });

    try {
        const tablesQuery = query(collection(firestore, 'tables'), where('storeId', '==', selectedStoreId), where('status', '==', 'Occupied'));
        const tablesSnapshot = await getDocs(tablesQuery);

        if (tablesSnapshot.empty) {
            toast({ title: 'No Occupied Tables', description: 'All tables are already available.' });
            return;
        }

        const batch = writeBatch(firestore);
        let tablesResetCount = 0;

        for (const tableDoc of tablesSnapshot.docs) {
            const table = { id: tableDoc.id, ...tableDoc.data() } as Table;
            
            if (table.activeOrderId) {
                const orderRef = doc(firestore, 'orders', table.activeOrderId);
                const orderSnap = await getDoc(orderRef);

                if (!orderSnap.exists() || (orderSnap.data() as Order).status !== 'Active') {
                    // Order doesn't exist or is not Active, so table is stuck.
                    batch.update(tableDoc.ref, { status: 'Available', activeOrderId: '' });
                    tablesResetCount++;
                }
            } else {
                // Table is 'Occupied' but has no activeOrderId, reset it.
                batch.update(tableDoc.ref, { status: 'Available', activeOrderId: '' });
                tablesResetCount++;
            }
        }
        
        if (tablesResetCount > 0) {
            await batch.commit();
            toast({ title: 'Cleanup Complete', description: `${tablesResetCount} stuck table(s) have been reset to "Available".` });
        } else {
            toast({ title: 'All Clear!', description: 'No stuck tables were found.' });
        }

    } catch (error) {
        console.error("Error resetting stuck tables:", error);
        toast({ variant: 'destructive', title: 'Cleanup Failed', description: 'An error occurred while resetting tables.' });
    }
  };
  
  const getStatusColor = (status: Table['status']) => {
    switch (status) {
      case 'Available': return 'bg-green-500';
      case 'Occupied': return 'bg-red-500';
      case 'Reserved': return 'bg-yellow-500';
      case 'Inactive': return 'bg-gray-500';
      default: return 'bg-gray-300';
    }
  }

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Table Management
        </h1>
        <div className="flex items-center gap-2">
           <Button variant="outline" onClick={handleResetStuckTables} disabled={!selectedStoreId}>
             <Wrench className="mr-2 h-4 w-4" /> Reset Stuck Tables
           </Button>
           <Button variant="destructive" onClick={resetAllCounters} disabled={tables.length === 0}>
            Reset All Counters
          </Button>
          <Dialog open={isModalOpen} onOpenChange={handleModalOpenChange}>
            <DialogTrigger asChild>
              <Button size="sm" className="flex items-center gap-2" onClick={() => handleOpenModal(null)} disabled={!selectedStoreId}>
                <PlusCircle className="h-4 w-4" />
                <span>Add Table</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editingTable ? 'Edit Table' : 'Add New Table'}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit}>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="tableName">Table Name</Label>
                    <Input id="tableName" name="tableName" value={formData.tableName} onChange={handleInputChange} required />
                  </div>
                   {currentStore && currentStore.tableLocations && currentStore.tableLocations.length > 0 && (
                     <div className="space-y-2">
                      <Label htmlFor="location">Location</Label>
                      <Select name="location" value={formData.location} onValueChange={(value) => handleSelectChange('location', value)} required>
                          <SelectTrigger>
                            <SelectValue placeholder="Select location" />
                          </SelectTrigger>
                          <SelectContent>
                            {currentStore.tableLocations.map(loc => (
                               <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                    </div>
                   )}
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select name="status" value={formData.status} onValueChange={(value) => handleSelectChange('status', value as Table['status'])} required>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Available">Available</SelectItem>
                          <SelectItem value="Occupied">Occupied</SelectItem>
                          <SelectItem value="Reserved">Reserved</SelectItem>
                          <SelectItem value="Inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                  </div>
                </div>
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => handleModalOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">{editingTable ? 'Save Changes' : 'Save'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      
      {!selectedStoreId ? (
        <Alert variant="info">
          <AlertTitle>No Store Selected</AlertTitle>
          <AlertDescription>Please select a store from the dropdown above to manage its tables.</AlertDescription>
        </Alert>
      ) : tables.length === 0 ? (
         <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed shadow-sm bg-background">
            <div className="flex flex-col items-center gap-1 text-center">
              <h3 className="text-2xl font-bold tracking-tight font-headline">
                No tables found for this store.
              </h3>
              <p className="text-sm text-muted-foreground">
                Click "Add Table" to get started.
              </p>
            </div>
          </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
            {tables.map((table) => (
            <Card key={table.id} className="flex flex-col">
                <CardHeader className="flex-grow pb-2">
                    <CardTitle className="text-base font-bold">{table.tableName}</CardTitle>
                    {table.location && <Badge variant="outline" className="w-fit">{table.location}</Badge>}
                </CardHeader>
                <CardContent className="flex-grow space-y-2">
                     <Badge className={cn("text-white w-full justify-center", getStatusColor(table.status))}>{table.status}</Badge>
                    <div className="text-xs text-muted-foreground">Order: {table.activeOrderId || 'N/A'}</div>
                    <div className="text-xs text-muted-foreground">Counter: {table.resetCounter}</div>
                </CardContent>
                <CardFooter className="p-2 border-t flex justify-end gap-1">
                     <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenModal(table)}>
                        <Edit className="h-4 w-4" />
                        <span className="sr-only">Edit</span>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDelete(table.id)}>
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete</span>
                    </Button>
                </CardFooter>
            </Card>
            ))}
        </div>
      )}
    </main>
  );
}
