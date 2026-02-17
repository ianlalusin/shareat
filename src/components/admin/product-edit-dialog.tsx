
"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "../ui/textarea";
import { collection, onSnapshot, query, where, orderBy, doc, writeBatch, setDoc, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { slugify } from "@/lib/utils/slugify";
import { Badge } from "../ui/badge";
import { uploadProductImage } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UploadCloud, Package, Trash2, Pencil } from "lucide-react";
import Image from "next/image";
import { Label } from "@/components/ui/label";
import type { Product } from "@/lib/types";
import { UOM_OPTIONS, normalizeUom } from "@/lib/uom";
import { Separator } from "../ui/separator";
import { getDisplayName } from "@/lib/products/variants";
import { useConfirmDialog } from "../global/confirm-dialog";
import { serverTimestamp } from "firebase/firestore";

type AddonCategory = {
    id: string;
    name: string;
    slug: string;
}

const formSchema = z.object({
  name: z.string().min(2, "Product name must be at least 2 characters."),
  hasVariants: z.boolean().default(false),
  variant: z.string().optional(),
  subCategory: z.string().optional(),
  uom: z.string().optional(),
  barcode: z.string().optional(),
  isActive: z.boolean().default(true),
});

export type ProductFormValues = z.infer<typeof formSchema> & {
    imageUrl?: string | null,
    imageFile?: File | null,
    variants?: Product[]
};

const variantSchema = z.object({
    id: z.string().optional(),
    variantLabel: z.string().min(1, "Label is required."),
    uom: z.string().min(1, "UOM is required."),
    barcode: z.string().optional(),
    isActive: z.boolean().default(true),
});
type VariantFormValues = z.infer<typeof variantSchema>;


function VariantRow({ variant, onEdit, onDelete }: { variant: Product, onEdit: (v: Product) => void, onDelete: (v: Product) => void }) {
    return (
        <div className="flex items-center gap-2 p-2 border rounded-md">
            <div className="flex-1">
                <p className="font-medium">{getDisplayName(variant)}</p>
                <div className="text-xs text-muted-foreground space-x-2">
                    <span>UOM: {variant.uom}</span>
                    <span>Barcode: {variant.barcode || 'N/A'}</span>
                </div>
            </div>
            <Badge variant={variant.isActive ? "default" : "outline"}>{variant.isActive ? "Active" : "Inactive"}</Badge>
            <Button type="button" variant="ghost" size="icon" onClick={() => onEdit(variant)}><Pencil /></Button>
            <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => onDelete(variant)}><Trash2 /></Button>
        </div>
    )
}

function VariantForm({ form, onSave, onCancel, parentProduct }: { form: any, onSave: (data: VariantFormValues) => void, onCancel: () => void, parentProduct: Product }) {
    return (
        <Form {...form}>
             <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
                <FormField control={form.control} name="variantLabel" render={({ field }) => (
                    <FormItem><FormLabel>Variant Label</FormLabel><FormControl><Input placeholder="e.g., 500ml, Large" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="uom" render={({ field }) => (
                        <FormItem><FormLabel>UOM</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{UOM_OPTIONS.map(opt => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>
                    )} />
                    <FormField control={form.control} name="barcode" render={({ field }) => (
                        <FormItem><FormLabel>Barcode</FormLabel><FormControl><Input placeholder="Optional" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                </div>
                <FormField control={form.control} name="isActive" render={({ field }) => (
                    <FormItem className="flex items-center gap-2"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl><FormLabel>Active</FormLabel></FormItem>
                )} />
                 <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
                    <Button type="button" onClick={form.handleSubmit(onSave)}>Save Variant</Button>
                </div>
            </div>
        </Form>
    )
}


interface ProductEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ProductFormValues) => void;
  product: Product | null;
  isSubmitting: boolean;
}

export function ProductEditDialog({ isOpen, onClose, onSave, product, isSubmitting }: ProductEditDialogProps) {
  const [addonCategories, setAddonCategories] = useState<AddonCategory[]>([]);
  const [subCategoryInput, setSubCategoryInput] = useState("");
  const { toast } = useToast();
  const { confirm } = useConfirmDialog();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [variants, setVariants] = useState<Product[]>([]);
  const [editingVariant, setEditingVariant] = useState<Product | null>(null);
  const [showVariantForm, setShowVariantForm] = useState(false);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", hasVariants: false, variant: "", subCategory: "", uom: "pcs", barcode: "", isActive: true, },
  });
  const hasVariants = useWatch({ control: form.control, name: 'hasVariants'});
  
  const variantForm = useForm<VariantFormValues>({
    resolver: zodResolver(variantSchema),
    defaultValues: { variantLabel: '', uom: 'pcs', barcode: '', isActive: true }
  });

  useEffect(() => {
    if (isOpen) {
      const isGroup = product?.kind === 'group';
      form.reset({
        name: product?.name || "",
        hasVariants: isGroup,
        variant: product?.variant || "",
        subCategory: product?.subCategory || "",
        uom: product ? normalizeUom(product.uom) : 'pcs',
        barcode: product?.barcode || "",
        isActive: product?.isActive ?? true,
      });
      setSubCategoryInput(product?.subCategory || "");
      setImageUrl(product?.imageUrl || null);
      setImageFile(null);
      setVariants([]);
      setShowVariantForm(false);
      setEditingVariant(null);
      
      if (isGroup && product.id) {
          const variantsQuery = query(collection(db, 'products'), where('groupId', '==', product.id));
          const unsub = onSnapshot(variantsQuery, (snap) => {
              setVariants(snap.docs.map(d => ({id: d.id, ...d.data() } as Product)));
          });
          return () => unsub();
      }
    }
  }, [product, isOpen, form]);
  
  useEffect(() => {
    const unsubAddonCategories = onSnapshot(query(collection(db, "addonCategories"), where("isActive", "==", true), orderBy("sortOrder")), (snapshot) => {
        setAddonCategories(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as AddonCategory));
    });
    return () => unsubAddonCategories();
  }, []);

  const handleImageSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImageUrl(URL.createObjectURL(file));
  };
  
  const handleEditVariant = (variant: Product) => {
    setEditingVariant(variant);
    variantForm.reset({
        id: variant.id,
        variantLabel: variant.variantLabel || '',
        uom: normalizeUom(variant.uom),
        barcode: variant.barcode || '',
        isActive: variant.isActive
    });
    setShowVariantForm(true);
  }

  const handleSaveVariant = async (data: VariantFormValues) => {
    if (!product) return; // Parent product must exist
    const batch = writeBatch(db);
    const parentName = form.getValues('name');
    
    if (editingVariant) { // --- UPDATE VARIANT ---
        const docRef = doc(db, 'products', editingVariant.id);
        batch.update(docRef, { ...data, updatedAt: serverTimestamp() });
    } else { // --- CREATE VARIANT ---
        const docRef = doc(collection(db, 'products'));
        const newVariant = {
            ...data,
            id: docRef.id,
            name: parentName,
            kind: 'variant',
            isSku: true,
            groupId: product.id,
            groupName: parentName,
            category: product.category,
            subCategory: product.subCategory,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };
        batch.set(docRef, newVariant);
    }
    
    await batch.commit();
    toast({ title: editingVariant ? "Variant Updated" : "Variant Added" });
    setShowVariantForm(false);
    setEditingVariant(null);
  }

  const handleDeleteVariant = async (variant: Product) => {
    if (await confirm({title: "Delete Variant?", description: "This cannot be undone.", destructive: true})) {
        await deleteDoc(doc(db, 'products', variant.id));
        toast({title: 'Variant Deleted'});
    }
  }


  const onSubmit = (data: z.infer<typeof formSchema>) => {
    onSave({ ...data, subCategory: subCategoryInput, imageUrl, imageFile, variants });
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90vh]">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>{product ? "Edit Product" : "Create New Product"}</DialogTitle>
          <DialogDescription>{product ? "Update the details of this product." : "Fill in the details to create a new global product."}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto">
          <div className="p-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} id="product-form" className="space-y-4">
                 <div className="space-y-2">
                    <Label>Product Image</Label>
                    <div className="flex items-center gap-4">
                        <div className="w-24 h-24 rounded-md border flex items-center justify-center bg-muted/50 relative">
                            {imageUrl ? (<Image src={imageUrl} alt="Product image" fill style={{objectFit:"cover"}} className="rounded-md" />) : (<Package className="h-10 w-10 text-muted-foreground" />)}
                        </div>
                        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><UploadCloud className="mr-2" /> Upload</Button>
                        <input type="file" ref={fileInputRef} onChange={handleImageSelection} className="hidden" accept="image/*" />
                    </div>
                </div>

                <FormField control={form.control} name="name" render={({ field }) => ( <FormItem><FormLabel>Product Name</FormLabel><FormControl><Input placeholder="e.g., Coca-cola" {...field} /></FormControl><FormMessage /></FormItem> )}/>
                <FormField control={form.control} name="variant" render={({ field }) => ( <FormItem><FormLabel>Description / Variant Notes</FormLabel><FormControl><Textarea placeholder="Describe the product..." {...field} /></FormControl><FormMessage /></FormItem> )}/>

                <FormItem>
                  <FormLabel>Sub-Category</FormLabel>
                  <FormControl><Input placeholder="e.g., Syrups, Meats" value={subCategoryInput} onChange={(e) => setSubCategoryInput(e.target.value)}/></FormControl>
                  <FormDescription className="text-xs pt-2">Suggestions: <span className="flex flex-wrap gap-1 mt-1">{addonCategories.map(cat => (<Badge key={cat.id} variant="secondary" className="cursor-pointer" onClick={() => { setSubCategoryInput(cat.name); form.setValue('subCategory', cat.name); }}>{cat.name}</Badge>))}</span></FormDescription>
                  <FormMessage />
                </FormItem>

                <FormField control={form.control} name="isActive" render={({ field }) => ( <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm"><div className="space-y-0.5"><FormLabel>Active</FormLabel><FormDescription className="text-xs">Inactive products cannot be used in recipes or menus.</FormDescription></div><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem> )}/>
                
                <Separator />
                
                <FormField control={form.control} name="hasVariants" render={({ field }) => ( <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm"><div className="space-y-0.5"><FormLabel>This product has variants</FormLabel><FormDescription className="text-xs">Manage multiple versions of this product (e.g., sizes, types).</FormDescription></div><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem> )}/>
                
                {hasVariants ? (
                    <div className="space-y-4">
                        <h4 className="font-semibold text-lg">Variants</h4>
                        <div className="space-y-2">
                          {variants.map(v => <VariantRow key={v.id} variant={v} onEdit={handleEditVariant} onDelete={handleDeleteVariant}/>)}
                        </div>
                        {showVariantForm ? (
                            <VariantForm form={variantForm} onSave={handleSaveVariant} onCancel={() => { setShowVariantForm(false); setEditingVariant(null); }} parentProduct={product!} />
                        ) : (
                            <Button type="button" variant="outline" onClick={() => { setEditingVariant(null); variantForm.reset({ variantLabel: '', uom: 'pcs', barcode: '', isActive: true }); setShowVariantForm(true)}}>+ Add Variant</Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="uom" render={({ field }) => ( <FormItem><FormLabel>UOM</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{UOM_OPTIONS.map(opt => ( <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem> ))}</SelectContent></Select><FormMessage /></FormItem> )}/>
                        <FormField control={form.control} name="barcode" render={({ field }) => ( <FormItem><FormLabel>Barcode</FormLabel><FormControl><Input placeholder="Optional" {...field} /></FormControl><FormMessage /></FormItem> )}/>
                    </div>
                )}
              </form>
            </Form>
          </div>
        </div>
        <DialogFooter className="p-6 pt-0">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" form="product-form" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Product"}</Button>
        </DialogFooter>
      </DialogContent>
    </>
  );
}
