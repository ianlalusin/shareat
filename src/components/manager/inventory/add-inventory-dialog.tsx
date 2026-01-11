
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader, Search } from "lucide-react";
import type { Product } from "@/lib/types";
import { getDisplayName } from "@/lib/products/variants";

interface AddInventoryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAddItems: (products: Product[]) => void;
  isSubmitting: boolean;
  existingProductIds?: string[];
}

export function AddInventoryDialog({ isOpen, onClose, onAddItems, isSubmitting, existingProductIds = [] }: AddInventoryDialogProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<Record<string, Product>>({});
  
  const existingIdsSet = useMemo(() => new Set(existingProductIds), [existingProductIds]);

  useEffect(() => {
    // Fetch only sellable SKUs (not group parents)
    const productsRef = collection(db, "products");
    const q = query(productsRef, where("isActive", "==", true), where("isSku", "==", true));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const productsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(productsData.sort((a, b) => a.name.localeCompare(b.name)));
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);
  
  useEffect(() => {
    if (isOpen) {
        setSelectedProducts({});
    }
  }, [isOpen]);

  const availableProducts = useMemo(() => {
    return products.filter(p => !existingIdsSet.has(p.id));
  }, [products, existingIdsSet]);

  const groupedAndFilteredProducts = useMemo(() => {
    const filtered = availableProducts.filter(p => getDisplayName(p).toLowerCase().includes(search.toLowerCase()));

    const grouped: Record<string, { groupName: string; items: Product[] }> = {};
    
    filtered.forEach(p => {
        const groupId = p.groupId || p.id;
        const groupName = p.groupName || p.name;
        
        if (!grouped[groupId]) {
            grouped[groupId] = { groupName: groupName, items: [] };
        }
        grouped[groupId].items.push(p);
    });

    return Object.values(grouped).sort((a,b) => a.groupName.localeCompare(b.groupName));

  }, [availableProducts, search]);


  const handleToggleSelect = (product: Product) => {
    setSelectedProducts(prev => {
      const newSelected = { ...prev };
      if (newSelected[product.id]) {
        delete newSelected[product.id];
      } else {
        newSelected[product.id] = product;
      }
      return newSelected;
    });
  };

  const handleAdd = () => {
    onAddItems(Object.values(selectedProducts));
  };
  
  const selectedCount = Object.keys(selectedProducts).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Products to Inventory</DialogTitle>
          <DialogDescription>Select products from the global catalog to add to this store's inventory.</DialogDescription>
        </DialogHeader>
        
        <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
                placeholder="Search for products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-full"
            />
        </div>

        <div className="max-h-[400px] overflow-y-auto border rounded-md">
            {isLoading ? (
                <div className="flex items-center justify-center h-32">
                    <Loader className="animate-spin" />
                </div>
            ) : (
                <Command>
                    <CommandList>
                        {groupedAndFilteredProducts.length > 0 ? (
                             groupedAndFilteredProducts.map(({ groupName, items }) => (
                                <CommandGroup key={groupName} heading={groupName}>
                                {items.map(product => (
                                    <CommandItem 
                                    key={product.id} 
                                    onSelect={() => handleToggleSelect(product)} 
                                    className="flex items-center gap-3"
                                    >
                                        <Checkbox
                                            id={`product-${product.id}`}
                                            checked={!!selectedProducts[product.id]}
                                            onCheckedChange={() => {}}
                                            aria-readonly="true"
                                        />
                                        <label htmlFor={`product-${product.id}`} className="flex-grow cursor-pointer">
                                            <div className="font-medium">{getDisplayName(product)}</div>
                                            <div className="text-xs text-muted-foreground capitalize">{product.subCategory} / {product.uom}</div>
                                        </label>
                                    </CommandItem>
                                ))}
                                </CommandGroup>
                            ))
                        ) : (
                            <CommandEmpty>No available products found.</CommandEmpty>
                        )}
                    </CommandList>
                </Command>
            )}
        </div>
        
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdd} disabled={isSubmitting || selectedCount === 0}>
            {isSubmitting ? "Adding..." : `Add ${selectedCount} Item(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
