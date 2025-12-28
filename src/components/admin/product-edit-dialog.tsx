
"use client";

import { useEffect, useState, useRef } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Product } from "@/app/admin/menu/products/page";
import { Textarea } from "../ui/textarea";
import { collection, onSnapshot, query, where, orderBy } from "firebase/firestore";
import { db, storage } from "@/lib/firebase/client";
import { slugify } from "@/lib/utils/slugify";
import { Badge } from "../ui/badge";
import { DialogDescription } from "../ui/dialog";
import { uploadProductImage } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, UploadCloud } from "lucide-react";
import Image from "next/image";
import { Package } from "lucide-react";
import { Label } from "@/components/ui/label";


type AddonCategory = {
    id: string;
    name: string;
    slug: string;
}

const formSchema = z.object({
  name: z.string().min(2, "Product name must be at least 2 characters."),
  variant: z.string().optional(),
  subCategory: z.string().optional(),
  uom: z.string().min(1, "UOM is required."),
  barcode: z.string().optional(),
  isActive: z.boolean().default(true),
});

type ProductFormValues = z.infer<typeof formSchema>;

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
  const [isUploading, setIsUploading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      variant: "",
      subCategory: "",
      uom: "pcs",
      barcode: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (isOpen) {
      if (product) {
        form.reset({
          name: product.name,
          variant: product.variant || "",
          subCategory: product.subCategory || "",
          uom: product.uom,
          barcode: product.barcode || "",
          isActive: product.isActive,
        });
        setSubCategoryInput(product.subCategory || "");
        setImageUrl(product.imageUrl || null);
      } else {
        form.reset({
          name: "",
          variant: "",
          subCategory: "",
          uom: "pcs",
          barcode: "",
          isActive: true,
        });
        setSubCategoryInput("");
        setImageUrl(null);
      }
    }
  }, [product, isOpen, form]);
  
  useEffect(() => {
    const unsubAddonCategories = onSnapshot(query(collection(db, "addonCategories"), where("isActive", "==", true), orderBy("sortOrder")), (snapshot) => {
        setAddonCategories(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}) as AddonCategory));
    });

    return () => {
        unsubAddonCategories();
    }
  }, []);

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!product) {
        toast({
            variant: "destructive",
            title: "Save Product First",
            description: "Please save the new product before uploading an image.",
        });
        return;
    }
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
        const url = await uploadProductImage(product.id, file);
        setImageUrl(url);
        toast({ title: "Image Uploaded" });
    } catch (error: any) {
        toast({
            variant: "destructive",
            title: "Upload Failed",
            description: error.message || "Could not upload the image.",
        });
    } finally {
        setIsUploading(false);
    }
  };


  const onSubmit = (data: ProductFormValues) => {
    onSave({ ...data, subCategory: subCategoryInput });
  };

  const dialogTitle = product ? "Edit Product" : "Create New Product";
  const dialogDescription = product ? "Update the details of this product." : "Fill in the details to create a new global product.";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90vh]">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto">
          <div className="p-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} id="product-form" className="space-y-4">
                 <div className="space-y-2">
                    <Label>Product Image</Label>
                    <div className="flex items-center gap-4">
                        <div className="w-24 h-24 rounded-md border flex items-center justify-center bg-muted/50 relative">
                            {imageUrl ? (
                                <Image src={imageUrl} alt="Product image" layout="fill" objectFit="cover" className="rounded-md" />
                            ) : (
                                <Package className="h-10 w-10 text-muted-foreground" />
                            )}
                        </div>
                        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!product || isUploading}>
                            {isUploading ? (
                                <Loader2 className="mr-2 animate-spin" />
                            ) : (
                                <UploadCloud className="mr-2" />
                            )}
                            Upload
                        </Button>
                        <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                    </div>
                </div>

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., All-Purpose Flour" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 <FormField
                  control={form.control}
                  name="variant"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Variant</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Describe the product variant..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormItem>
                  <FormLabel>Sub-Category</FormLabel>
                  <FormControl>
                     <Input 
                        placeholder="e.g., Syrups, Meats" 
                        value={subCategoryInput}
                        onChange={(e) => setSubCategoryInput(e.target.value)}
                     />
                  </FormControl>
                  <FormDescription className="text-xs pt-2">
                    Suggestions:
                    <span className="flex flex-wrap gap-1 mt-1">
                      {addonCategories.map(cat => (
                        <Badge
                          key={cat.id}
                          variant="secondary"
                          className="cursor-pointer"
                          onClick={() => {
                            setSubCategoryInput(cat.name);
                            form.setValue('subCategory', cat.name);
                          }}
                        >
                          {cat.name}
                        </Badge>
                      ))}
                    </span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>


                 <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="uom"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>UOM</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g., pcs, kg, g" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                     <FormField
                        control={form.control}
                        name="barcode"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel>Barcode</FormLabel>
                            <FormControl>
                            <Input placeholder="Optional" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                </div>

                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>Active</FormLabel>
                        <FormDescription className="text-xs">
                          Inactive products cannot be used in recipes or menus.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          </div>
        </div>
        <DialogFooter className="p-6 pt-0">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save Product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

    