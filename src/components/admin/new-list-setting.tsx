
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
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wrench, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { useFirestore } from '@/firebase';
import {
  addDoc,
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc,
  query,
  where,
} from 'firebase/firestore';
import { useStoreSelector } from '@/store/use-store-selector';
import { useToast } from '@/hooks/use-toast';
import { GListItem } from '@/lib/types';

export function NewListSetting() {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<GListItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemValue, setEditingItemValue] = useState('');

  const firestore = useFirestore();
  const { toast } = useToast();
  const { selectedStoreId } = useStoreSelector();

  useEffect(() => {
    if (!firestore || !isOpen) return;

    const itemsCollectionRef = collection(doc(firestore, 'lists', 'Mode of Payment'), 'items');
    const q = query(itemsCollectionRef, where('storeIds', 'array-contains', selectedStoreId));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedItems = snapshot.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() } as GListItem)
      );
      setItems(fetchedItems);
    });

    return () => unsubscribe();
  }, [firestore, isOpen, selectedStoreId]);

  const handleAddItem = async () => {
    if (!newItem.trim() || !firestore || !selectedStoreId) return;
    try {
      const itemsCollectionRef = collection(doc(firestore, 'lists', 'Mode of Payment'), 'items');
      await addDoc(itemsCollectionRef, {
        item: newItem.trim(),
        category: 'Mode of Payment',
        is_active: true,
        storeIds: [selectedStoreId],
      });
      setNewItem('');
      toast({ title: 'Success', description: 'Mode of Payment added.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not add item.',
      });
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!firestore) return;
    try {
      const itemDocRef = doc(collection(doc(firestore, 'lists', 'Mode of Payment'), 'items'), itemId);
      await deleteDoc(itemDocRef);
      toast({ title: 'Success', description: 'Item deleted.' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Could not delete item.',
      });
    }
  };

  const handleEditItem = (item: GListItem) => {
    setEditingItemId(item.id);
    setEditingItemValue(item.item);
  };
  
  const handleUpdateItem = async () => {
      if (!editingItemId || !editingItemValue.trim() || !firestore) return;
      try {
        const itemDocRef = doc(collection(doc(firestore, 'lists', 'Mode of Payment'), 'items'), editingItemId);
        await updateDoc(itemDocRef, { item: editingItemValue.trim() });
        setEditingItemId(null);
        setEditingItemValue('');
        toast({ title: 'Success', description: 'Item updated.' });
      } catch (error) {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Could not update item.',
        });
      }
  };
  
  const handleCancelEdit = () => {
      setEditingItemId(null);
      setEditingItemValue('');
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <Button
            variant="destructive"
            className="fixed bottom-4 right-4 h-14 w-14 rounded-full shadow-lg"
          >
            <Wrench className="h-6 w-6" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mode of Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
                placeholder="Add new MOP and press Enter"
              />
              <Button onClick={handleAddItem}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md border p-2"
                >
                  {editingItemId === item.id ? (
                      <>
                        <Input 
                            value={editingItemValue}
                            onChange={(e) => setEditingItemValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleUpdateItem()}
                            className="h-8"
                        />
                        <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleUpdateItem}><Check className="h-4 w-4 text-green-500" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={handleCancelEdit}><X className="h-4 w-4 text-red-500" /></Button>
                        </div>
                      </>
                  ) : (
                    <>
                      <span>{item.item}</span>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleEditItem(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleDeleteItem(item.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
