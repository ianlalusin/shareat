"use client";

import * as React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, writeBatch, Timestamp, setDoc, getDocs, deleteDoc, query, where, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, Upload, Download, Package, Search } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ProductEditDialog, type ProductFormValues } from "@/components/admin/product-edit-dialog";
import { ProductDetailsModal } from "@/components/admin/product-details-modal";
import { slugify } from "@/lib/utils/slugify";
import type { Product } from "@/lib/types";
import { uploadProductImage } from "@/lib/firebase/client";
import { getKind, getDisplayName } from "@/lib/products/variants";
import { exportToXlsx } from "@/lib/export/export-xlsx-client";
import { read, utils } from "xlsx";
import { ProductImportPreviewDialog } from "@/components/admin/product-import-preview-dialog";
import { normalizeUom } from "@/lib/uom";
import Image from "next/image";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";

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
  
  const [parsedImportData, setParsedImportData] = useState<any[]>([]);
  const [isImportPreviewOpen, setIsImportPreviewOpen] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

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
    const filteredProducts = debouncedSearchTerm
      ? products.filter(p =>
          getDisplayName(p).toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
          p.barcode?.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
        )
      : products;

    const grouped = filteredProducts.reduce((acc, product) => {
      const subCategory = product.subCategory || 'Uncategorized';

      if (!acc[subCategory]) {
        acc[subCategory] = [];
      }
      acc[subCategory].push(product);
      return acc;
    }, {} as Record<string, Product[]>);

    // Sort products within each sub-category
    for (const subCategory in grouped) {
        grouped[subCategory].sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
    }
    
    // Sort subcategories
    return Object.keys(grouped).sort().reduce((acc, subCategory) => {
        acc[subCategory] = grouped[subCategory];
        return acc;
    }, {} as Record<string, Product[]>);

  }, [products, debouncedSearchTerm]);


  const handleOpenDialog = (product: Product | null = null) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setEditingProduct(null);
    setIsDialogOpen(false);
  };

  const handleSaveProduct = async (formData: ProductFormValues) => {
    if (!appUser) return;
    setIsSubmitting(true);
    
    const { imageFile, ...productData } = formData;

    // Normalize data to ensure required fields are present
    const dataToSave: Partial<Product> = {
        name: productData.name,
        isActive: productData.isActive,
        variant: productData.variant || "",
        uom: productData.uom || "pcs",
        barcode: productData.barcode || "",
        category: "Add-on", // Default category
        subCategory: productData.subCategory || "Uncategorized",
        kind: productData.hasVariants ? "group" : "single",
        isSku: !productData.hasVariants,
    };

    try {
        if (editingProduct) { // --- UPDATE EXISTING PRODUCT ---
            const batch = writeBatch(db);
            const productDocRef = doc(db, "products", editingProduct.id);
            let finalImageUrl = editingProduct.imageUrl || null;

            if (imageFile) {
                finalImageUrl = await uploadProductImage(productDocRef.id, imageFile);
            }

            const payload = { ...dataToSave, imageUrl: finalImageUrl, updatedAt: serverTimestamp() };
            batch.update(productDocRef, payload);

            if (dataToSave.subCategory) {
                const subCategorySlug = slugify(dataToSave.subCategory);
                const categoryRef = doc(db, "addonCategories", subCategorySlug);
                batch.set(categoryRef, {
                    id: categoryRef.id, name: dataToSave.subCategory, slug: subCategorySlug, isActive: true, sortOrder: 0,
                    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
                }, { merge: true });
            }

            await batch.commit();
            toast({ title: "Product Updated" });
        } else { // --- CREATE NEW PRODUCT ---
            const batch = writeBatch(db);
            const productDocRef = doc(collection(db, "products"));
            
            // Create the product first without the image URL
            const initialPayload = {
                ...dataToSave,
                id: productDocRef.id,
                imageUrl: null, // Set to null initially
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };
            batch.set(productDocRef, initialPayload);
            
            // Manage sub-category
            if (dataToSave.subCategory) {
                const subCategorySlug = slugify(dataToSave.subCategory);
                const categoryRef = doc(db, "addonCategories", subCategorySlug);
                batch.set(categoryRef, {
                    id: categoryRef.id, name: dataToSave.subCategory, slug: subCategorySlug, isActive: true, sortOrder: 0,
                    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
                }, { merge: true });
            }
            
            await batch.commit(); // Commit the initial product creation

            // If there's an image, upload it now and update the document
            if (imageFile) {
                await uploadProductImage(productDocRef.id, imageFile);
            }
            
            toast({ title: "Product Created" });
        }
        
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
        title: `${action} ${getDisplayName(product)}?`,
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
        toast({ title: "Product Status Updated", description: `${getDisplayName(product)} has been ${action.toLowerCase()}d.` });
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
  
  const handleDeleteProduct = async (product: Product) => {
    // This is the key change: ensure the details modal is closed
    // so its overlay doesn't interfere with the confirmation dialog.
    setSelectedProduct(null);
    
    if (!appUser?.isPlatformAdmin) {
      toast({ variant: "destructive", title: "Permission Denied" });
      return;
    }
    
    const isGroup = getKind(product) === 'group';
    const confirmed = await confirm({
      title: `Permanently Delete ${getDisplayName(product)}?`,
      description: isGroup 
        ? "This action is irreversible and will also delete all of its variants. This cannot be undone."
        : "This action is irreversible and cannot be undone.",
      confirmText: "Yes, Delete Permanently",
      destructive: true,
    });
  
    if (!confirmed) return;
  
    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);
  
      if (isGroup) {
        const variantsQuery = query(collection(db, "products"), where("groupId", "==", product.id));
        const variantsSnap = await getDocs(variantsQuery);
        variantsSnap.forEach(doc => batch.delete(doc.ref));
      }
  
      batch.delete(doc(db, "products", product.id));
      
      await batch.commit();
      
      toast({ title: "Product Deleted", description: `${getDisplayName(product)} and its data have been removed.` });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Delete Failed", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

    const handleExportTemplate = () => {
        const headers = ["name", "variantLabel", "uom", "category", "subCategory", "barcode", "isActive"];
        const sampleData = [{
            name: "Sample Product",
            variantLabel: "Large",
            uom: "pcs",
            category: "Add-on",
            subCategory: "Drinks",
            barcode: "1234567890123",
            isActive: "true"
        }];
        exportToXlsx({ 
            rows: sampleData.map(row => ({
                name: row.name,
                variantLabel: row.variantLabel,
                uom: row.uom,
                category: row.category,
                subCategory: row.subCategory,
                barcode: row.barcode,
                isActive: row.isActive,
            })), 
            sheetName: "Products", 
            filename: "product_import_template.xlsx" 
        });
    };
  
    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsSubmitting(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = read(data);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json: any[] = utils.sheet_to_json(worksheet);

            if (json.length === 0) {
                toast({ variant: 'destructive', title: 'Empty File', description: 'The selected file has no data to import.' });
                return;
            }
            
            setParsedImportData(json);
            setIsImportPreviewOpen(true);

        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Import Failed', description: error.message });
        } finally {
            setIsSubmitting(false);
            if(fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };
    
    const handleConfirmImport = async (validatedData: any[]) => {
        setIsImportPreviewOpen(false);
        setIsSubmitting(true);
        
        try {
            const batch = writeBatch(db);
            const productsRef = collection(db, "products");
            
            validatedData.forEach(row => {
                const docRef = row.barcode ? doc(productsRef, slugify(row.barcode)) : doc(productsRef);
                const newProduct: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> = {
                    name: row.name,
                    variantLabel: row.variantLabel || null,
                    uom: normalizeUom(row.uom || "pcs"),
                    category: row.category || "Add-on",
                    subCategory: row.subCategory || "Uncategorized",
                    barcode: row.barcode || null,
                    isActive: row.isActive,
                    isSku: true,
                    kind: row.variantLabel ? "variant" : "single",
                };
                
                batch.set(docRef, { ...newProduct, id: docRef.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            });

            await batch.commit();
            toast({ title: "Import Successful", description: `Added ${validatedData.length} new products.` });
        } catch (error: any) {
            toast({ variant: 'destructive', title: 'Import Failed', description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };


  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader title="Product Management" description="Manage all global products available in the system.">
        <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportTemplate}><Download className="mr-2"/> Export Template</Button>
            <Button onClick={() => fileInputRef.current?.click()}><Upload className="mr-2"/> Import Products</Button>
            <input type="file" ref={fileInputRef} onChange={handleImport} className="hidden" accept=".xlsx, .xls, .csv" />
            <Button onClick={() => handleOpenDialog()}>
            <PlusCircle className="mr-2" /> New Product
            </Button>
        </div>
      </PageHeader>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>All Products</CardTitle>
              <CardDescription>A list of all centrally-managed products, grouped by sub-category.</CardDescription>
            </div>
            <div className="relative w-full max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by name or barcode..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8"
                />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <Loader className="animate-spin" />
            </div>
          ) : Object.keys(groupedAndSortedProducts).length > 0 ? (
            <Table>
                {Object.entries(groupedAndSortedProducts).map(([subCategory, items]) => (
                    <React.Fragment key={subCategory}>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead colSpan={6} className="text-lg font-semibold text-foreground">
                                    {subCategory}
                                </TableHead>
                            </TableRow>
                            <TableRow>
                                <TableHead>Image</TableHead>
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
                                    <TableCell>
                                        <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center relative">
                                            {product.imageUrl ? (
                                                <Image src={product.imageUrl} alt={product.name} fill style={{objectFit:"cover"}} className="rounded-md" />
                                            ) : (
                                                <Package className="h-6 w-6 text-muted-foreground"/>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-medium">{getDisplayName(product)}</TableCell>
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
                                        variant={product.isActive ? "secondary" : "default"}
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
            <p className="text-center text-muted-foreground py-8">{searchTerm ? `No products found for "${searchTerm}".` : 'No products found. Click "New Product" to add one.'}</p>
          )}
        </CardContent>
      </Card>
      
      {isImportPreviewOpen && (
        <ProductImportPreviewDialog
            isOpen={isImportPreviewOpen}
            onClose={() => setIsImportPreviewOpen(false)}
            data={parsedImportData}
            onConfirm={handleConfirmImport}
        />
      )}

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
            onDelete={handleDeleteProduct}
        />
      )}

      {Dialog}
    </RoleGuard>
  );
}
