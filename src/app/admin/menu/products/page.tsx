
"use client";

import * as React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, writeBatch, Timestamp, setDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, Upload } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ProductEditDialog } from "@/components/admin/product-edit-dialog";
import { ProductDetailsModal } from "@/components/admin/product-details-modal";
import { slugify } from "@/lib/utils/slugify";
import type { Product } from "@/lib/types";
import { uploadProductImage } from "@/lib/firebase/client";
import * as XLSX from "xlsx";

export default function ProductManagementPage() {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const { confirm, Dialog } = useConfirmDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!appUser) return;

    const productsRef = collection(db, "products");
    const unsubscribe = onSnapshot(productsRef, (snapshot) => {
      const productsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product));
      setProducts(productsData);
      setIsLoading(false);
    }, (error) => {
      console.error("Failed to fetch products:", error);
      toast({ variant: "destructive", title: "Error", description: "Could not fetch products." });
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [appUser, toast]);

  const groupedAndSortedProducts = useMemo(() => {
    const grouped = products.reduce((acc, product) => {
      const subCategory = product.subCategory || 'Uncategorized';

      if (!acc[subCategory]) {
        acc[subCategory] = [];
      }
      acc[subCategory].push(product);
      return acc;
    }, {} as Record<string, Product[]>);

    // Sort products within each sub-category
    for (const subCategory in grouped) {
        grouped[subCategory].sort((a, b) => a.name.localeCompare(b.name));
    }
    
    // Sort subcategories
    return Object.keys(grouped).sort().reduce((acc, subCategory) => {
        acc[subCategory] = grouped[subCategory];
        return acc;
    }, {} as Record<string, Product[]>);

  }, [products]);


  const handleOpenDialog = (product: Product | null = null) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setEditingProduct(null);
    setIsDialogOpen(false);
  };

  const handleSaveProduct = async (productData: Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'category' | 'imageUrl'> & { category?: string; imageUrl?: string | null, imageFile?: File | null }) => {
    if (!appUser) return;
    setIsSubmitting(true);
    
    const { imageFile, ...dataToSave } = productData;
    dataToSave.category = "Add-on";

    try {
      const batch = writeBatch(db);
      let productDocRef;
      let finalImageUrl = dataToSave.imageUrl;

      if (editingProduct) {
        productDocRef = doc(db, "products", editingProduct.id);
        batch.update(productDocRef, { ...dataToSave, updatedAt: serverTimestamp() });
      } else {
        productDocRef = doc(collection(db, "products"));
        batch.set(productDocRef, { ...dataToSave, id: productDocRef.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      }
      
      if (imageFile) {
        finalImageUrl = await uploadProductImage(productDocRef.id, imageFile);
        batch.update(productDocRef, { imageUrl: finalImageUrl });
      }
      
      if (dataToSave.category === 'Add-on' && dataToSave.subCategory) {
          const subCategorySlug = slugify(dataToSave.subCategory);
          const categoryRef = doc(db, "addonCategories", subCategorySlug);
          batch.set(categoryRef, {
              id: categoryRef.id, name: dataToSave.subCategory, slug: subCategorySlug, isActive: true, sortOrder: 0, 
              createdAt: serverTimestamp(), updatedAt: serverTimestamp()
          }, { merge: true });
      }

      await batch.commit();
      toast({ title: editingProduct ? "Product Updated" : "Product Created" });
      handleCloseDialog();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (product: Product) => {
    if (!appUser) return;
    const newStatus = !product.isActive;
    const action = newStatus ? "Activate" : "Deactivate";
    
    const confirmed = await confirm({
        title: `${action} ${product.name}?`,
        description: `Are you sure you want to ${action.toLowerCase()} this product?`,
        confirmText: `Yes, ${action}`,
        destructive: !newStatus,
    });

    if (!confirmed) return;

    setIsSubmitting(true);
    try {
        const productDocRef = doc(db, "products", product.id);
        await updateDoc(productDocRef, {
            isActive: newStatus,
            updatedAt: serverTimestamp(),
        });
        toast({ title: "Product Status Updated", description: `${product.name} has been ${action.toLowerCase()}d.` });
    } catch (error: any) {
        toast({
            variant: "destructive",
            title: "Update Failed",
            description: error.message || "Could not update the product status.",
        });
    } finally {
        setIsSubmitting(false);
    }
  };
  
  const handleEditFromDetails = (product: Product) => {
    setSelectedProduct(null);
    handleOpenDialog(product);
  };
  
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !appUser) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const data = e.target?.result;
        if (!data) {
            toast({ variant: "destructive", title: "File Read Error" });
            return;
        }

        setIsSubmitting(true);
        try {
            const workbook = XLSX.read(data, { type: 'binary' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json: any[] = XLSX.utils.sheet_to_json(worksheet);

            const productsRef = collection(db, "products");
            const categoriesRef = collection(db, "addonCategories");
            const existingProductsSnap = await getDocs(productsRef);
            const existingProductNames = new Set(existingProductsSnap.docs.map(doc => doc.data().name.toLowerCase()));
            const batch = writeBatch(db);
            let importedCount = 0;

            for (const item of json) {
                if (!item.name || !item.uom) continue;
                if (existingProductNames.has(item.name.toLowerCase())) continue;

                const newProductRef = doc(productsRef);
                batch.set(newProductRef, {
                    id: newProductRef.id,
                    name: item.name,
                    variant: item.variant || "",
                    uom: item.uom,
                    category: "Add-on", // Default to Add-on
                    subCategory: item.subCategory || "Uncategorized",
                    barcode: item.barcode || "",
                    isActive: item.isActive !== undefined ? item.isActive : true,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                
                if (item.subCategory) {
                    const subCategorySlug = slugify(item.subCategory);
                    const categoryRef = doc(categoriesRef, subCategorySlug);
                    batch.set(categoryRef, { id: categoryRef.id, name: item.subCategory, slug: subCategorySlug, isActive: true, sortOrder: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
                }

                importedCount++;
            }

            await batch.commit();
            toast({ title: "Import Complete", description: `${importedCount} new products were imported.` });
        } catch (error: any) {
            toast({ variant: "destructive", title: "Import Failed", description: error.message });
        } finally {
            setIsSubmitting(false);
            if(fileInputRef.current) fileInputRef.current.value = "";
        }
    };
    reader.readAsBinaryString(file);
  };


  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader title="Product Management" description="Manage all global products available in the system.">
        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx, .xls, .csv" />
        <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isSubmitting}>
            <Upload className="mr-2" /> Import
        </Button>
        <Button onClick={() => handleOpenDialog()}>
          <PlusCircle className="mr-2" /> New Product
        </Button>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>All Products</CardTitle>
          <CardDescription>A list of all centrally-managed products, grouped by sub-category.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <Loader className="animate-spin" />
            </div>
          ) : products.length > 0 ? (
            <Table>
                {Object.entries(groupedAndSortedProducts).map(([subCategory, items]) => (
                    <React.Fragment key={subCategory}>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead colSpan={5} className="text-lg font-semibold text-foreground">
                                    {subCategory}
                                </TableHead>
                            </TableRow>
                            <TableRow>
                                <TableHead>Product Name</TableHead>
                                <TableHead>UOM</TableHead>
                                <TableHead>Barcode</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                         <TableBody>
                            {items.map((product) => (
                                <TableRow key={product.id} onClick={() => setSelectedProduct(product)} className="cursor-pointer">
                                    <TableCell className="font-medium">{product.name}</TableCell>
                                    <TableCell>{product.uom}</TableCell>
                                    <TableCell>{product.barcode || '—'}</TableCell>
                                    <TableCell>
                                        <Badge variant={product.isActive ? "default" : "secondary"}>
                                            {product.isActive ? "Active" : "Inactive"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                    <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleOpenDialog(product); }} className="mr-2">
                                        Edit
                                    </Button>
                                    <Button
                                        variant={product.isActive ? "destructive" : "default"}
                                        size="sm"
                                        onClick={(e) => { e.stopPropagation(); handleToggleActive(product);}}
                                        disabled={isSubmitting}
                                    >
                                        {product.isActive ? <PowerOff className="mr-2"/> : <Power className="mr-2" />}
                                        {product.isActive ? "Deactivate" : "Activate"}
                                    </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </React.Fragment>
                ))}
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">No products found. Click "New Product" to add one.</p>
          )}
        </CardContent>
      </Card>

      {isDialogOpen && (
        <ProductEditDialog
          isOpen={isDialogOpen}
          onClose={handleCloseDialog}
          onSave={handleSaveProduct}
          product={editingProduct}
          isSubmitting={isSubmitting}
        />
      )}
      
      {selectedProduct && (
        <ProductDetailsModal
            isOpen={!!selectedProduct}
            onClose={() => setSelectedProduct(null)}
            product={selectedProduct}
            onEdit={handleEditFromDetails}
        />
      )}

      {Dialog}
    </RoleGuard>
  );
}
