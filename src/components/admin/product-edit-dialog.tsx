
"use client";

import { useEffect, useState, useRef, useMemo, useCallback } from "react";
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
import { ImageBoundary } from "@/components/shared/ImageBoundary";
import { OptionGroupEditDialog } from "@/components/admin/option-groups/OptionGroupEditDialog";
import { OptionGroupPicker } from "@/components/admin/option-groups/OptionGroupPicker";

type AddonCategory = {
    id: string;
    name: string;
    slug: string;
}

const formSchema = z.object({
  name: z.string().min(2, "Product name must be at least 2 characters."),
  hasVariants: z.boolean().default(false),
  variant: z.string().optional(),
  description: z.string().optional(),
  subCategory: z.string().optional(),
  uom: z.string().optional(),
  barcode: z.string().optional(),
  isActive: z.boolean().default(true),
  optionGroupIds: z.array(z.string()).optional(),
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
    // Adds to whatever the family parent already gives this variant — the
    // resolver unions the two (see lib/server/catalog-shared.ts).
    optionGroupIds: z.array(z.string()).optional(),
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

function VariantForm({ form, onSave, onCancel, parentProduct, availableOptionGroups, parentOptionGroupIds, onCreateOptionGroup }: {
    form: any,
    onSave: (data: VariantFormValues) => void,
    onCancel: () => void,
    parentProduct: Product,
    availableOptionGroups: Array<{ id: string; name: string; selectionMode?: "single" | "multi"; values?: Array<{ isActive?: boolean }> }>,
    /** What the family already gives this variant — shown read-only, not re-attachable. */
    parentOptionGroupIds: string[],
    onCreateOptionGroup: () => void,
}) {
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
                <FormField control={form.control} name="optionGroupIds" render={({ field }) => (
                    <FormItem>
                        <OptionGroupPicker
                            value={field.value as string[] | undefined}
                            onChange={field.onChange}
                            available={availableOptionGroups}
                            onCreateNew={onCreateOptionGroup}
                            inheritedIds={parentOptionGroupIds}
                            label="Option Groups for this variant only"
                            description="Extra modifiers only this variant offers — e.g. Extra Nori on Signature but not Veggies. These ADD to what the family already gives it."
                        />
                        <FormMessage />
                    </FormItem>
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
  /**
   * Called after an in-dialog variant add/edit/delete that could change the
   * public storefront — i.e. when the parent family is shown on the storefront.
   * The page uses it to schedule a debounced storefront republish.
   */
  onStorefrontMayChange?: () => void;
}

export function ProductEditDialog({ isOpen, onClose, onSave, product, isSubmitting, onStorefrontMayChange }: ProductEditDialogProps) {
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

  // Option groups available to attach to this product. Loaded once when the
  // dialog opens; the picker UI is a chip list inside the form.
  const [availableOptionGroups, setAvailableOptionGroups] = useState<Array<{
    id: string; name: string; selectionMode: "single" | "multi"; values: any[];
  }>>([]);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", hasVariants: false, variant: "", description: "", subCategory: "", uom: "pcs", barcode: "", isActive: true, optionGroupIds: [], },
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
        description: (product as any)?.description || "",
        subCategory: product?.subCategory || "",
        uom: product ? normalizeUom(product.uom) : 'pcs',
        barcode: product?.barcode || "",
        isActive: product?.isActive ?? true,
        optionGroupIds: (product as any)?.optionGroupIds || [],
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

  // Load reusable option groups. Read-only fetch via the admin endpoint so this
  // works regardless of Firestore-client rules. Reusable so we can refresh after
  // creating a new group inline.
  const loadOptionGroups = useCallback(async () => {
    try {
      const { getAuth } = await import("firebase/auth");
      const user = getAuth().currentUser;
      if (!user) return;
      const idToken = await user.getIdToken();
      const res = await fetch("/api/admin/option-groups", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok) {
        setAvailableOptionGroups(
          (json.groups || []).filter((g: any) => g.isActive !== false && g.isArchived !== true)
        );
      }
    } catch {
      // silent — section just shows empty state
    }
  }, []);

  // Inline "create option group" dialog state.
  const [newOptionGroupOpen, setNewOptionGroupOpen] = useState(false);
  // Which picker opened the inline create dialog, so the new group auto-attaches
  // where the admin was actually working rather than always on the parent.
  const [newOptionGroupTarget, setNewOptionGroupTarget] = useState<"parent" | "variant">("parent");

  useEffect(() => {
    if (isOpen) void loadOptionGroups();
  }, [isOpen, loadOptionGroups]);

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
        isActive: variant.isActive,
        // Without this the picker opens empty and the save below would clear
        // whatever this variant already had attached.
        optionGroupIds: (variant as any).optionGroupIds || [],
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
    // Any store may be offering this family online, and the admin cannot
    // know which; the publish itself is debounced and pilot-store scoped.
    onStorefrontMayChange?.();
    setShowVariantForm(false);
    setEditingVariant(null);
  }

  const handleDeleteVariant = async (variant: Product) => {
    if (await confirm({title: "Delete Variant?", description: "This cannot be undone.", destructive: true})) {
        await deleteDoc(doc(db, 'products', variant.id));
        toast({title: 'Variant Deleted'});
        onStorefrontMayChange?.();
    }
  }


  const onSubmit = (data: z.infer<typeof formSchema>) => {
    onSave({ ...data, subCategory: subCategoryInput, imageUrl, imageFile, variants });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90dvh] overflow-hidden">
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
                              <ImageBoundary>
                                {imageUrl ? (<Image src={imageUrl} alt="Product image" fill style={{objectFit:"cover"}} className="rounded-md" />) : (<Package className="h-10 w-10 text-muted-foreground" />)}
                              </ImageBoundary>
                          </div>
                          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}><UploadCloud className="mr-2" /> Upload</Button>
                          <input type="file" ref={fileInputRef} onChange={handleImageSelection} className="hidden" accept="image/*" />
                      </div>
                  </div>

                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Name</FormLabel>
                      <FormControl><Input placeholder="e.g., Coca-cola" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}/>

                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl><Textarea placeholder="Short description shown to customers on the website (e.g. “Crispy seaweed rice rolls with veggies”)" rows={3} {...field} /></FormControl>
                      <FormDescription className="text-xs">Shown to customers on the online store. Keep it appetizing — not internal notes.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}/>

                  <FormItem>
                    <FormLabel>Sub-Category</FormLabel>
                    <FormControl><Input placeholder="e.g., Syrups, Meats" value={subCategoryInput} onChange={(e) => setSubCategoryInput(e.target.value)}/></FormControl>
                    <FormDescription className="text-xs pt-2">Suggestions: <span className="flex flex-wrap gap-1 mt-1">{addonCategories.map(cat => (<Badge key={cat.id} variant="secondary" className="cursor-pointer" onClick={() => { setSubCategoryInput(cat.name); form.setValue('subCategory', cat.name); }}>{cat.name}</Badge>))}</span></FormDescription>
                    <FormMessage />
                  </FormItem>

                  <FormField control={form.control} name="isActive" render={({ field }) => ( <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm"><div className="space-y-0.5"><FormLabel>Active</FormLabel><FormDescription className="text-xs">Inactive products cannot be used in recipes or menus.</FormDescription></div><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem> )}/>


                  <Separator />

                  <FormField control={form.control} name="hasVariants" render={({ field }) => ( <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm"><div className="space-y-0.5"><FormLabel>This product has variants</FormLabel><FormDescription className="text-xs">Manage multiple versions of this product (e.g., sizes, types). Each variant is its own SKU with its own barcode and inventory.</FormDescription></div><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem> )}/>

                  {hasVariants ? (
                      // Family / group mode. The umbrella doesn't have its own variant
                      // label / UOM / barcode — those live on each child variant.
                      <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                          <div>
                              <h4 className="font-semibold">Variants</h4>
                              <p className="text-xs text-muted-foreground">Each row below is a sellable SKU. The variant label is what appears in the parens (e.g., <code className="text-[11px]">Kimpab (Signature)</code>).</p>
                          </div>
                          <div className="space-y-2">
                            {variants.length === 0 && (
                              <p className="text-sm text-muted-foreground">No variants yet. Add one below to begin.</p>
                            )}
                            {variants.map(v => <VariantRow key={v.id} variant={v} onEdit={handleEditVariant} onDelete={handleDeleteVariant}/>)}
                          </div>
                          {showVariantForm ? (
                              <VariantForm
                                  form={variantForm}
                                  onSave={handleSaveVariant}
                                  onCancel={() => { setShowVariantForm(false); setEditingVariant(null); }}
                                  parentProduct={product!}
                                  availableOptionGroups={availableOptionGroups}
                                  parentOptionGroupIds={(form.getValues("optionGroupIds") as string[]) || []}
                                  onCreateOptionGroup={() => { setNewOptionGroupTarget("variant"); setNewOptionGroupOpen(true); }}
                                />
                          ) : (
                              <Button type="button" variant="outline" onClick={() => { setEditingVariant(null); variantForm.reset({ variantLabel: '', uom: 'pcs', barcode: '', isActive: true, optionGroupIds: [] }); setShowVariantForm(true)}}>+ Add Variant</Button>
                          )}
                      </div>
                  ) : (
                      // Single SKU mode. Single-axis variant label + UOM + barcode all
                      // belong to this product itself.
                      <div className="space-y-4">
                          <FormField control={form.control} name="variant" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Variant Label</FormLabel>
                              <FormControl><Input placeholder='Optional. e.g., "Signature", "500ml"' {...field} /></FormControl>
                              <FormDescription className="text-xs">Appended to the product name in lists, e.g. <code className="text-[11px]">Kimpab (Signature)</code>. Leave blank if this product has no variant axis.</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}/>
                          <div className="grid grid-cols-2 gap-4">
                              <FormField control={form.control} name="uom" render={({ field }) => ( <FormItem><FormLabel>UOM</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl><SelectContent>{UOM_OPTIONS.map(opt => ( <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem> ))}</SelectContent></Select><FormMessage /></FormItem> )}/>
                              <FormField control={form.control} name="barcode" render={({ field }) => ( <FormItem><FormLabel>Barcode</FormLabel><FormControl><Input placeholder="Optional" {...field} /></FormControl><FormMessage /></FormItem> )}/>
                          </div>
                      </div>
                  )}

                  <Separator />

                  <FormField
                    control={form.control}
                    name="optionGroupIds"
                    render={({ field }) => {
                      return (
                        <FormItem>
                          <OptionGroupPicker
                            value={field.value as string[] | undefined}
                            onChange={field.onChange}
                            available={availableOptionGroups}
                            onCreateNew={() => { setNewOptionGroupTarget("parent"); setNewOptionGroupOpen(true); }}
                            description="Reusable modifier groups applied at order time. When this product is added to a bill the cashier (and customer) is prompted to pick from each attached group. For a family, attach here what EVERY variant offers — a variant can add its own on top."
                          />
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
                </form>
              </Form>
            </div>
          </div>
          <DialogFooter className="p-6 pt-0">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" form="product-form" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Product"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inline "create option group" — reuses the admin dialog; auto-attaches on save. */}
      <OptionGroupEditDialog
        open={newOptionGroupOpen}
        onOpenChange={setNewOptionGroupOpen}
        group={null}
        onSaved={async (savedId) => {
          await loadOptionGroups();
          if (savedId) {
            // Branch rather than union the two form handles: they are different
            // schemas, so a shared reference loses the field types entirely.
            if (newOptionGroupTarget === "variant") {
              const cur = (variantForm.getValues("optionGroupIds") as string[]) || [];
              if (!cur.includes(savedId)) variantForm.setValue("optionGroupIds", [...cur, savedId], { shouldDirty: true });
            } else {
              const cur = (form.getValues("optionGroupIds") as string[]) || [];
              if (!cur.includes(savedId)) form.setValue("optionGroupIds", [...cur, savedId], { shouldDirty: true });
            }
          }
          setNewOptionGroupOpen(false);
        }}
      />
    </>
  );
}
