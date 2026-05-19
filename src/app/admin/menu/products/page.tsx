
"use client";

import * as React from "react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, doc, updateDoc, serverTimestamp, writeBatch, Timestamp, setDoc, getDocs, deleteDoc, query, where, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader, PlusCircle, Power, PowerOff, Upload, Download, Package, Search, ArrowLeft, ChevronRight, ChevronDown, GitMerge, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ProductEditDialog, type ProductFormValues } from "@/components/admin/product-edit-dialog";
import { ProductDetailsModal } from "@/components/admin/product-details-modal";
import { ProductMergeDialog } from "@/components/admin/product-merge-dialog";
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
  const router = useRouter();
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

  // Multi-row selection + merge state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedIds.has(p.id)),
    [products, selectedIds]
  );

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

    // Partition into families. Variants whose parent isn't in the visible set
    // (filtered out or missing) become "orphans" rendered flat with a warning.
    const filteredIds = new Set(filteredProducts.map((p) => p.id));
    const variantsByGroupId = new Map<string, Product[]>();
    for (const p of filteredProducts) {
      if (getKind(p) === "variant" && p.groupId) {
        const arr = variantsByGroupId.get(p.groupId) || [];
        arr.push(p);
        variantsByGroupId.set(p.groupId, arr);
      }
    }

    // Top-level rows are: groups + singletons + orphan variants (whose group isn't visible).
    // Each entry's subCategory determines which section it falls under.
    type TopLevelRow =
      | { kind: "group"; product: Product; variants: Product[] }
      | { kind: "single"; product: Product }
      | { kind: "orphan"; product: Product };

    const topLevel: TopLevelRow[] = [];
    for (const p of filteredProducts) {
      const k = getKind(p);
      if (k === "group") {
        const variants = (variantsByGroupId.get(p.id) || []).slice().sort((a, b) =>
          getDisplayName(a).localeCompare(getDisplayName(b))
        );
        topLevel.push({ kind: "group", product: p, variants });
      } else if (k === "single") {
        topLevel.push({ kind: "single", product: p });
      } else if (k === "variant") {
        const parentVisible = p.groupId && filteredIds.has(p.groupId);
        if (!parentVisible) {
          topLevel.push({ kind: "orphan", product: p });
        }
        // visible-parent variants are rendered nested under their group, NOT at top level
      }
    }

    const grouped = topLevel.reduce((acc, row) => {
      const subCategory = row.product.subCategory || 'Uncategorized';
      if (!acc[subCategory]) acc[subCategory] = [];
      acc[subCategory].push(row);
      return acc;
    }, {} as Record<string, TopLevelRow[]>);

    for (const subCategory in grouped) {
      grouped[subCategory].sort((a, b) =>
        getDisplayName(a.product).localeCompare(getDisplayName(b.product))
      );
    }

    return Object.keys(grouped).sort().reduce((acc, subCategory) => {
      acc[subCategory] = grouped[subCategory];
      return acc;
    }, {} as Record<string, TopLevelRow[]>);

  }, [products, debouncedSearchTerm]);

  type TopLevelRow =
    | { kind: "group"; product: Product; variants: Product[] }
    | { kind: "single"; product: Product }
    | { kind: "orphan"; product: Product };


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

    // Normalize data to ensure required fields are present.
    // Family/group products don't carry their own variant label, UOM, or barcode —
    // those live on each child variant SKU. We force them blank to avoid stale
    // data lingering on a product that was just toggled into group mode.
    const isGroup = productData.hasVariants;
    const optionGroupIds = Array.isArray((productData as any).optionGroupIds)
      ? ((productData as any).optionGroupIds as string[]).filter((v) => typeof v === "string" && v.length > 0)
      : [];
    const dataToSave: Partial<Product> = {
        name: productData.name,
        isActive: productData.isActive,
        variant: isGroup ? "" : (productData.variant || ""),
        description: (productData as any).description || "",
        uom: isGroup ? "pcs" : (productData.uom || "pcs"),
        barcode: isGroup ? "" : (productData.barcode || ""),
        category: "Add-on", // Default category
        subCategory: productData.subCategory || "Uncategorized",
        kind: isGroup ? "group" : "single",
        isSku: !isGroup,
        optionGroupIds,
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
        <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            {selectedIds.size >= 2 && (
              <Button onClick={() => setMergeDialogOpen(true)}>
                <GitMerge className="mr-2 h-4 w-4" /> Merge Selected ({selectedIds.size})
              </Button>
            )}
            {selectedIds.size > 0 && (
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Clear selection
              </Button>
            )}
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
                {Object.entries(groupedAndSortedProducts).map(([subCategory, rows]) => (
                    <React.Fragment key={subCategory}>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead colSpan={7} className="text-lg font-semibold text-foreground">
                                    {subCategory}
                                </TableHead>
                            </TableRow>
                            <TableRow>
                                <TableHead className="w-10"></TableHead>
                                <TableHead className="w-10"></TableHead>
                                <TableHead>Image</TableHead>
                                <TableHead>Product Name</TableHead>
                                <TableHead>UOM</TableHead>
                                <TableHead>Barcode</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                         <TableBody>
                            {rows.map((row) => {
                                const p = row.product;
                                const isGroup = row.kind === "group";
                                const isOrphan = row.kind === "orphan";
                                const expanded = expandedGroupIds.has(p.id);
                                return (
                                  <React.Fragment key={p.id}>
                                    <TableRow onClick={() => setSelectedProduct(p)} className="cursor-pointer">
                                        <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
                                            {!isGroup && (
                                              <Checkbox
                                                checked={selectedIds.has(p.id)}
                                                onCheckedChange={() => toggleSelected(p.id)}
                                                aria-label={`Select ${getDisplayName(p)}`}
                                              />
                                            )}
                                        </TableCell>
                                        <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
                                            {isGroup ? (
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6"
                                                onClick={() => toggleExpanded(p.id)}
                                                aria-label={expanded ? "Collapse family" : "Expand family"}
                                              >
                                                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                              </Button>
                                            ) : null}
                                        </TableCell>
                                        <TableCell>
                                            <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center relative">
                                                {p.imageUrl ? (
                                                    <Image src={p.imageUrl} alt={p.name} fill style={{objectFit:"cover"}} className="rounded-md" />
                                                ) : (
                                                    <Package className="h-6 w-6 text-muted-foreground"/>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-medium">
                                            <div className="flex items-center gap-2">
                                                <span>{getDisplayName(p)}</span>
                                                {isGroup && (
                                                  <Badge variant="outline" className="text-xs">Family · {row.variants.length}</Badge>
                                                )}
                                                {isOrphan && (
                                                  <Badge variant="destructive" className="text-xs gap-1">
                                                    <AlertTriangle className="h-3 w-3" /> Orphan variant
                                                  </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>{p.uom}</TableCell>
                                        <TableCell>{p.barcode || '—'}</TableCell>
                                        <TableCell>
                                            <Badge variant={p.isActive ? "default" : "secondary"}>
                                                {p.isActive ? "Active" : "Inactive"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleOpenDialog(p); }} className="mr-2">
                                                Edit
                                            </Button>
                                            {!isGroup && (
                                              <Button
                                                  variant={p.isActive ? "secondary" : "default"}
                                                  size="sm"
                                                  onClick={(e) => { e.stopPropagation(); handleToggleActive(p);}}
                                                  disabled={isSubmitting}
                                              >
                                                  {p.isActive ? <PowerOff className="mr-2"/> : <Power className="mr-2" />}
                                                  {p.isActive ? "Deactivate" : "Activate"}
                                              </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                    {isGroup && expanded && row.variants.map((v) => (
                                      <TableRow key={v.id} onClick={() => setSelectedProduct(v)} className="cursor-pointer bg-muted/20">
                                        <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
                                            <Checkbox
                                              checked={selectedIds.has(v.id)}
                                              onCheckedChange={() => toggleSelected(v.id)}
                                              aria-label={`Select ${getDisplayName(v)}`}
                                            />
                                        </TableCell>
                                        <TableCell className="w-10"></TableCell>
                                        <TableCell>
                                            <div className="ml-6 w-10 h-10 rounded-md bg-muted flex items-center justify-center relative">
                                                {v.imageUrl ? (
                                                    <Image src={v.imageUrl} alt={v.name} fill style={{objectFit:"cover"}} className="rounded-md" />
                                                ) : (
                                                    <Package className="h-5 w-5 text-muted-foreground"/>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-medium pl-6 text-sm">
                                            ↳ {v.variantLabel || v.variant || "(unlabeled)"}
                                        </TableCell>
                                        <TableCell>{v.uom}</TableCell>
                                        <TableCell>{v.barcode || '—'}</TableCell>
                                        <TableCell>
                                            <Badge variant={v.isActive ? "default" : "secondary"}>
                                                {v.isActive ? "Active" : "Inactive"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleOpenDialog(v); }} className="mr-2">Edit</Button>
                                            <Button
                                                variant={v.isActive ? "secondary" : "default"}
                                                size="sm"
                                                onClick={(e) => { e.stopPropagation(); handleToggleActive(v);}}
                                                disabled={isSubmitting}
                                            >
                                                {v.isActive ? <PowerOff className="mr-2"/> : <Power className="mr-2" />}
                                                {v.isActive ? "Deactivate" : "Activate"}
                                            </Button>
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </React.Fragment>
                                );
                            })}
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

      {mergeDialogOpen && (
        <ProductMergeDialog
          open={mergeDialogOpen}
          onOpenChange={setMergeDialogOpen}
          selected={selectedProducts}
          onMerged={() => {
            clearSelection();
            setMergeDialogOpen(false);
          }}
        />
      )}

      {Dialog}
    </RoleGuard>
  );
}
