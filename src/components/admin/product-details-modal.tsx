
"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Edit, Package, Tag, Hash, Barcode, Ruler, FileText, Image as ImageIcon } from "lucide-react";
import type { Product } from "@/app/admin/menu/products/page";
import Image from "next/image";

interface ProductDetailsModalProps {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (product: Product) => void;
}

export function ProductDetailsModal({ product, isOpen, onClose, onEdit }: ProductDetailsModalProps) {
  if (!product) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <div className="flex items-start gap-4">
                     <div className="p-3 bg-muted rounded-md relative h-20 w-20 flex-shrink-0">
                        {product.imageUrl ? (
                            <Image src={product.imageUrl} alt={product.name} layout="fill" objectFit="cover" className="rounded-md"/>
                        ) : (
                            <Package className="h-full w-full text-muted-foreground" />
                        )}
                    </div>
                    <div className="grid gap-1 pt-2">
                        <DialogTitle className="text-2xl">{product.name}</DialogTitle>
                        <DialogDescription>Product ID: {product.id}</DialogDescription>
                    </div>
                </div>
            </DialogHeader>
            
            <div className="grid gap-4 py-4">
                <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                     <Badge variant={product.isActive ? 'default' : 'secondary'} className="capitalize">{product.isActive ? 'Active' : 'Inactive'}</Badge>
                </div>
                
                <Separator />

                <div className="grid gap-3">
                     <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><FileText /> Variant</span>
                        <span className="font-medium text-sm text-right">{product.variant || 'N/A'}</span>
                    </div>
                    <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Tag /> Category</span>
                        <span className="font-medium text-sm">{product.category || 'N/A'}</span>
                    </div>
                    <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Tag /> Sub-Category</span>
                        <span className="font-medium text-sm">{product.subCategory || 'N/A'}</span>
                    </div>
                    <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Ruler /> UOM</span>
                        <span className="font-medium text-sm">{product.uom}</span>
                    </div>
                    <div className="flex items-start justify-between">
                        <span className="text-sm text-muted-foreground flex items-center gap-2"><Barcode /> Barcode</span>
                        <span className="font-medium text-sm">{product.barcode || 'N/A'}</span>
                    </div>
                </div>
            </div>
            
             <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end w-full">
                <Button variant="secondary" onClick={onClose}>Close</Button>
                <Button variant="outline" onClick={() => onEdit(product)}>
                    <Edit className="mr-2 h-4 w-4" /> Edit
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
  );
}
