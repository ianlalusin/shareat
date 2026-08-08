"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Image from "next/image";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Package, UploadCloud } from "lucide-react";
import { ImageBoundary } from "@/components/shared/ImageBoundary";
import { UOM_OPTIONS, normalizeUom } from "@/lib/uom";
import { buildNameKey } from "@/lib/product-requests/shared";
import type { KitchenLocation, Product, ProductRequest } from "@/lib/types";

type AddonCategory = { id: string; name: string; slug: string };

const formSchema = z
  .object({
    requestKind: z.enum(["addon", "product"]),
    name: z.string().min(2, "Product name must be at least 2 characters."),
    variant: z.string().optional(),
    description: z.string().optional(),
    uom: z.string().min(1, "Pick a unit of measure."),
    barcode: z.string().optional(),
    suggestedPrice: z.coerce.number().min(0, "Price cannot be negative."),
    cost: z.coerce.number().min(0, "Cost cannot be negative."),
    kitchenLocationId: z.string().optional(),
    justification: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    // Mirrors the precondition in /manager/inventory: an inventory item cannot
    // be flagged as an add-on without a positive price and a kitchen station.
    // Enforcing it here means an approved add-on lands ready to sell.
    if (v.requestKind !== "addon") return;
    if (!(v.suggestedPrice > 0)) {
      ctx.addIssue({
        path: ["suggestedPrice"],
        code: z.ZodIssueCode.custom,
        message: "An add-on needs a price greater than zero.",
      });
    }
    if (!v.kitchenLocationId) {
      ctx.addIssue({
        path: ["kitchenLocationId"],
        code: z.ZodIssueCode.custom,
        message: "Pick the kitchen station that will prepare this.",
      });
    }
  });

export type ProductRequestFormValues = z.infer<typeof formSchema> & {
  subCategory: string;
  kitchenLocationName: string | null;
  imageFile: File | null;
  /**
   * The photo already in Storage, carried over when a declined request is
   * re-raised without picking a new file. Null once the user replaces it.
   */
  existingImageUrl: string | null;
};

interface ProductRequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (values: ProductRequestFormValues) => void;
  isSubmitting: boolean;
  storeId: string;
  /** Pre-fills the form when a manager re-raises a declined request. */
  prefill?: ProductRequest | null;
}

export function ProductRequestDialog({
  isOpen,
  onClose,
  onSave,
  isSubmitting,
  storeId,
  prefill,
}: ProductRequestDialogProps) {
  const [addonCategories, setAddonCategories] = useState<AddonCategory[]>([]);
  const [kitchenLocations, setKitchenLocations] = useState<KitchenLocation[]>([]);
  const [kitchenLoaded, setKitchenLoaded] = useState(false);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [subCategoryInput, setSubCategoryInput] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.input<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      requestKind: "addon",
      name: "",
      variant: "",
      description: "",
      uom: "pcs",
      barcode: "",
      suggestedPrice: 0,
      cost: 0,
      kitchenLocationId: undefined,
      justification: "",
    },
  });

  const requestKind = useWatch({ control: form.control, name: "requestKind" });
  const nameValue = useWatch({ control: form.control, name: "name" });
  const variantValue = useWatch({ control: form.control, name: "variant" });

  useEffect(() => {
    if (!isOpen) return;
    form.reset({
      requestKind: prefill?.requestKind ?? "addon",
      name: prefill?.name ?? "",
      variant: prefill?.variant ?? "",
      description: prefill?.description ?? "",
      uom: prefill ? normalizeUom(prefill.uom) : "pcs",
      barcode: prefill?.barcode ?? "",
      suggestedPrice: prefill?.suggestedPrice ?? 0,
      cost: prefill?.cost ?? 0,
      kitchenLocationId: prefill?.kitchenLocationId ?? undefined,
      justification: prefill?.justification ?? "",
    });
    setSubCategoryInput(prefill?.subCategory ?? "");
    setImagePreview(prefill?.imageUrl ?? null);
    setExistingImageUrl(prefill?.imageUrl ?? null);
    setImageFile(null);
  }, [isOpen, prefill, form]);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "addonCategories"), where("isActive", "==", true), orderBy("sortOrder")),
      (snap) => setAddonCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AddonCategory)),
      () => setAddonCategories([])
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!storeId) return;
    setKitchenLoaded(false);
    const unsub = onSnapshot(
      query(collection(db, "stores", storeId, "kitchenLocations"), where("isActive", "==", true)),
      (snap) => {
        setKitchenLocations(snap.docs.map((d) => d.data() as KitchenLocation));
        setKitchenLoaded(true);
      },
      () => {
        setKitchenLocations([]);
        setKitchenLoaded(true);
      }
    );
    return () => unsub();
  }, [storeId]);

  // Same query AddInventoryDialog uses. Powers the live "already exists" hint so
  // most duplicates never reach the server check.
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "products"), where("isActive", "==", true), where("isSku", "==", true)),
      (snap) => setCatalog(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Product)),
      () => setCatalog([])
    );
    return () => unsub();
  }, []);

  const duplicate = useMemo(() => {
    const typed = String(nameValue || "").trim();
    if (typed.length < 2) return null;
    const key = buildNameKey(typed, variantValue || null);
    return (
      catalog.find(
        (p) => buildNameKey(p.name ?? "", (p as any).variantLabel ?? p.variant ?? null) === key
      ) || null
    );
  }, [catalog, nameValue, variantValue]);

  // Gate on kitchenLoaded, not on the array being empty: the subscription starts
  // out empty, so without this a store that *does* have stations would be forced
  // to "product" on the first render.
  const hasKitchenStations = kitchenLoaded && kitchenLocations.length > 0;

  // A store with no kitchen stations cannot have a sellable add-on, so steer it
  // to a regular product request rather than letting it submit something the
  // approve op would only have to degrade.
  useEffect(() => {
    if (isOpen && kitchenLoaded && kitchenLocations.length === 0 && requestKind === "addon") {
      form.setValue("requestKind", "product");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kitchenLoaded, kitchenLocations.length, isOpen, requestKind]);

  const handleImageSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setExistingImageUrl(null);
    setImagePreview(URL.createObjectURL(file));
  };

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    const station = kitchenLocations.find((k) => k.id === data.kitchenLocationId);
    onSave({
      ...data,
      subCategory: subCategoryInput.trim(),
      kitchenLocationName: station?.name ?? null,
      imageFile,
      existingImageUrl,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90dvh] overflow-hidden">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>New Product Request</DialogTitle>
          <DialogDescription>
            Apply to add this item to the global catalog. An admin reviews it; once approved it is
            added to your store at your suggested price, and other stores can import it.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} id="product-request-form" className="space-y-4 pb-4">
              <FormField
                control={form.control}
                name="requestKind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="addon" disabled={!hasKitchenStations}>
                          Add-on
                        </SelectItem>
                        <SelectItem value="product">Regular product</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      {hasKitchenStations
                        ? "Add-ons appear in the cashier add-ons modal and print to a kitchen station."
                        : "This store has no active kitchen stations yet, so an add-on cannot be created. Add one in Store Settings, or submit this as a regular product."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex items-start gap-4">
                <div className="w-24 h-24 shrink-0 rounded-md border flex items-center justify-center bg-muted/50 relative">
                  <ImageBoundary>
                    {imagePreview ? (
                      <Image
                        src={imagePreview}
                        alt="Proposed product"
                        fill
                        style={{ objectFit: "cover" }}
                        className="rounded-md"
                      />
                    ) : (
                      <Package className="h-10 w-10 text-muted-foreground" />
                    )}
                  </ImageBoundary>
                </div>
                <div className="space-y-2">
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <UploadCloud className="mr-2 h-4 w-4" /> Upload photo
                  </Button>
                  <p className="text-xs text-muted-foreground">Optional, but it helps the reviewer.</p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImageSelection}
                    className="hidden"
                    accept="image/*"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Truffle Dip" {...field} />
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
                        <Input placeholder="Optional, e.g., Large" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {duplicate && (
                <div className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-amber-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-xs">
                    <span className="font-medium">&quot;{duplicate.name}&quot; already exists</span> in the
                    global catalog. You can add it to your store directly from Menu →
                    Add Products to Inventory — no request needed.
                  </p>
                </div>
              )}

              <FormItem>
                <FormLabel>Sub-Category</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g., Dips, Sides"
                    value={subCategoryInput}
                    onChange={(e) => setSubCategoryInput(e.target.value)}
                  />
                </FormControl>
                {addonCategories.length > 0 && (
                  <FormDescription className="text-xs pt-2">
                    Suggestions:
                    <span className="flex flex-wrap gap-1 mt-1">
                      {addonCategories.map((cat) => (
                        <Badge
                          key={cat.id}
                          variant="secondary"
                          className="cursor-pointer"
                          onClick={() => setSubCategoryInput(cat.name)}
                        >
                          {cat.name}
                        </Badge>
                      ))}
                    </span>
                  </FormDescription>
                )}
              </FormItem>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="uom"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit of Measure</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {UOM_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="suggestedPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Suggested Selling Price</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormDescription className="text-xs">
                        Your store&apos;s price. Every other store sets its own when it imports.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="cost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} />
                      </FormControl>
                      <FormDescription className="text-xs">Optional. Leave at 0 if unknown.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {requestKind === "addon" && (
                <FormField
                  control={form.control}
                  name="kitchenLocationId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kitchen Station</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Where is this prepared?" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {kitchenLocations.map((k) => (
                            <SelectItem key={k.id} value={k.id}>
                              {k.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription className="text-xs">
                        Required for add-ons — tickets print here, and the add-on switch cannot be
                        turned on without it.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Optional" rows={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="justification"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Why does your store need this?</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Shown to the admin reviewing this request."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </div>

        <DialogFooter className="p-6 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="product-request-form" disabled={isSubmitting}>
            {isSubmitting ? "Submitting..." : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
