
'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHead,
  TableRow,
} from '@/components/ui/table';
import { PlusCircle, MinusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useFirestore, useAuth } from '@/firebase';
import {
  collection,
  doc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { Product, Inventory } from '@/lib/types';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useStoreSelector } from '@/store/use-store-selector';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

type AdjustmentType = 'add' | 'set';

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('add');
  const [quantity, setQuantity] = useState<number | ''>('');
  
  const firestore = useFirestore();
  const auth = useAuth();
  const { selectedStoreId } = useStoreSelector();

  useEffect(() => {
    if (firestore) {
      const productsUnsubscribe = onSnapshot(collection(firestore, 'products'), (snapshot) => {
        const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Product[];
        setProducts(itemsData);
      });

      if (selectedStoreId) {
        const inventoryQuery = query(collection(firestore, 'inventory'), where('storeId', '==', selectedStoreId));
        const inventoryUnsubscribe = onSnapshot(inventoryQuery, (snapshot) => {
          const invData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Inventory));
          setInventory(invData);
        });

        return () => {
          productsUnsubscribe();
          inventoryUnsubscribe();
        };
      } else {
        setInventory([]);
      }

      return () => productsUnsubscribe();
    }
  }, [firestore, selectedStoreId]);

  const openModal = (product: Product, type: AdjustmentType) => {
    setSelectedProduct(product);
    setAdjustmentType(type);
    setIsModalOpen(true);
    setQuantity('');
  };

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuantity(value === '' ? '' : Number(value));
  };
  
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firestore || !auth?.currentUser || !selectedProduct || !selectedStoreId || quantity === '') return;

    const user = auth.currentUser;
    const inventoryQuery = query(
      collection(firestore, 'inventory'),
      where('storeId', '==', selectedStoreId),
      where('productId', '==', selectedProduct.id)
    );

    try {
      const querySnapshot = await getDocs(inventoryQuery);
      const batch = writeBatch(firestore);
      let newQuantity = 0;
      let inventoryDocRef;

      if (!querySnapshot.empty) {
        // Update existing inventory item
        const inventoryDoc = querySnapshot.docs[0];
        inventoryDocRef = inventoryDoc.ref;
        const currentQuantity = inventoryDoc.data().quantity || 0;

        if (adjustmentType === 'add') {
          newQuantity = currentQuantity + Number(quantity);
        } else { // 'set'
          newQuantity = Number(quantity);
        }
        
        batch.update(inventoryDocRef, {
          quantity: newQuantity,
          updatedAt: serverTimestamp(),
          lastUpdatedBy: user.displayName || user.email,
        });

      } else {
        // Create new inventory item
        inventoryDocRef = doc(collection(firestore, 'inventory'));
        newQuantity = adjustmentType === 'add' ? Number(quantity) : Number(quantity);
        
        batch.set(inventoryDocRef, {
          productId: selectedProduct.id,
          storeId: selectedStoreId,
          quantity: newQuantity,
          updatedAt: serverTimestamp(),
          lastUpdatedBy: user.displayName || user.email,
        });
      }
      
      await batch.commit();
      setIsModalOpen(false);
    } catch (error) {
      console.error('Error updating inventory: ', error);
    }
  };


  const getProductInventory = (productId: string) => {
    const item = inventory.find(inv => inv.productId === productId);
    return item ? item.quantity : 0;
  };

  const groupedProducts = useMemo(() => {
    const grouped = products.reduce((acc, item) => {
      const category = item.category || 'Uncategorized';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(item);
      return acc;
    }, {} as Record<string, Product[]>);
    
    return Object.keys(grouped).sort().reduce(
      (obj, key) => { 
        obj[key] = grouped[key].sort((a, b) => a.productName.localeCompare(b.productName)); 
        return obj;
      }, 
      {} as Record<string, Product[]>
    );
  }, [products]);
  

  return (
      <main className="flex flex-1 flex-col gap-2 p-2 lg:gap-3 lg:p-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl font-headline">
          Inventory Management
        </h1>
      </div>

       {!selectedStoreId ? (
          <Alert>
            <AlertTitle>No Store Selected</AlertTitle>
            <AlertDescription>Please select a store from the dropdown above to manage its inventory.</AlertDescription>
          </Alert>
        ) : (
          <Accordion type="multiple" className="w-full" defaultValue={Object.keys(groupedProducts)}>
            {Object.entries(groupedProducts).map(([category, itemsInCategory]) => (
              <AccordionItem key={category} value={category} className="border-0">
                 <div className="rounded-lg border shadow-sm bg-background overflow-hidden">
                   <div className="flex items-center justify-between p-2 bg-muted/50 hover:bg-muted/80">
                    <AccordionTrigger className="flex-1 p-0 hover:no-underline">
                      <div className='flex items-center gap-2'>
                          <h2 className="text-base font-semibold">{category}</h2>
                          <Badge variant="secondary">{itemsInCategory.length}</Badge>
                      </div>
                    </AccordionTrigger>
                   </div>
                  <AccordionContent className="p-0">
                    <div className="border-t overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="px-2 h-10">Product Name</TableHead>
                            <TableHead className="px-2 h-10 text-right">Quantity</TableHead>
                            <TableHead className="px-2 h-10">Unit</TableHead>
                            <TableHead className="px-2 h-10">
                              <span className="sr-only">Actions</span>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {itemsInCategory.map((item) => (
                            <TableRow key={item.id} className="cursor-pointer">
                              <TableCell className="p-2 font-medium">{item.productName}</TableCell>
                              <TableCell className="p-2 text-right font-bold text-lg">{getProductInventory(item.id)}</TableCell>
                              <TableCell className="p-2">{item.unit}</TableCell>
                              <TableCell className="p-2 text-right">
                                  <Button size="sm" variant="outline" className="mr-2" onClick={() => openModal(item, 'add')}>
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Add Stock
                                  </Button>
                                  <Button size="sm" onClick={() => openModal(item, 'set')}>
                                      Set Stock
                                  </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </AccordionContent>
                 </div>
              </AccordionItem>
            ))}
          </Accordion>
      )}

      {selectedProduct && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{adjustmentType === 'add' ? 'Add to' : 'Set'} Stock: {selectedProduct.productName}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit}>
                <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="quantity">Quantity</Label>
                      <Input 
                        id="quantity" 
                        name="quantity" 
                        type="number" 
                        value={quantity}
                        onChange={handleQuantityChange}
                        required 
                      />
                    </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save</Button>
                </DialogFooter>
              </form>
            </DialogContent>
        </Dialog>
      )}

      </main>
  );
}

