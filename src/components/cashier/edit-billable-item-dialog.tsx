
"use client";

import { useEffect, useState, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { QuantityInput } from "./quantity-input";
import { Minus, Plus, Loader2, RefreshCw } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { Discount, SessionBillLine, InventoryItem } from "@/lib/types";
import { Alert, AlertTitle, AlertDescription } from "../ui/alert";
import { useAuthContext } from "@/context/auth-context";
import { serverTimestamp, doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { allowsDecimalQty } from "@/lib/uom";

const VOID_REASONS = {
  wrong_item: "Wrong Item Ordered",
  customer_request: "Customer Changed Mind / Cancelled",
  duplicate_entry: "Duplicate Entry Error",
  pricing_error: "Pricing Error",
  other: "Other",
};

const formSchema = z.object({
  qtyOrdered: z.coerce.number().min(0, "Quantity must be non-negative."),
  unitPrice: z.coerce.number().min(0),
  
  applyDiscount: z.boolean().default(false),
  discountId: z.string().optional(),
  discountType: z.enum(["fixed", "percent"]).nullable().optional(),
  discountValue: z.coerce.number().min(0).default(0),
  discountQty: z.coerce.number().min(0),

  applyFree: z.boolean().default(false),
  freeQty: z.coerce.number().min(0),
  
  applyVoid: z.boolean().default(false),
  voidQty: z.coerce.number().min(0),
  voidReason: z.string().optional(),
  voidNote: z.string().optional(),
}).refine(data => data.discountQty + data.freeQty + (data.voidQty || 0) <= data.qtyOrdered, {
    message: "Sum of discounted, free, and voided items cannot exceed total quantity.",
    path: ["qtyOrdered"],
}).refine(data => data.applyDiscount ? (data.discountId && data.discountType && data.discountValue > 0 && data.discountQty > 0) || (data.discountId === 'custom' && data.discountValue > 0 && data.discountQty > 0) : true, {
    message: "If discount is applied, you must select a valid preset or custom value and quantity.",
    path: ["applyDiscount"],
});


type FormValues = z.infer<typeof formSchema>;

interface EditBillableItemDialogProps {
    isOpen: boolean;
    onClose: () => void;
    line: SessionBillLine | null;
    discounts: Discount[];
    isLocked?: boolean;
    onSave: (lineId: string, before: Partial<SessionBillLine>, after: Partial<SessionBillLine>) => void;
}

function normalizeDiscountType(t: any): "fixed" | "percent" | null {
    if (t === "percentage" || t === "percent") return "percent";
    if (t === "fixed") return "fixed";
    return null;
}

function QuantityStepper({ label, value, onChange, max, min = 0, description, step = 1, canDecrease = true, allowDecimal = false }: { 
    label: string, 
    value: number, 
    onChange: (val: number) => void, 
    max: number, 
    min?: number, 
    description?: string, 
    step?: number, 
    canDecrease?: boolean,
    allowDecimal?: boolean,
}) {
    return (
        <FormItem>
            <FormLabel>{label}</FormLabel>
            <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon" onClick={() => onChange(Math.max(min, value - step))} disabled={!canDecrease}><Minus/></Button>
                <QuantityInput 
                    value={value}
                    onChange={onChange}
                    className="text-center"
                    allowDecimal={allowDecimal}
                />
                <Button type="button" variant="outline" size="icon" onClick={() => onChange(Math.min(max, value + step))}><Plus/></Button>
            </div>
            {description && <FormDescription className="text-xs">{description}</FormDescription>}
             <FormMessage />
        </FormItem>
    );
}

export function EditBillableItemDialog({ 
    isOpen, 
    onClose, 
    line,
    discounts, 
    isLocked,
    onSave,
}: EditBillableItemDialogProps) {
    const { appUser } = useAuthContext();
    const { activeStore } = useStoreContext();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [inventoryItem, setInventoryItem] = useState<InventoryItem | null>(null);

    const isPackage = line?.type === 'package';
    const isAddon = line?.type === 'addon';
    
    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
    });
    
    const { control, handleSubmit, reset, setValue, watch, getValues, trigger } = form;
    
    const watchedValues = watch();

     useEffect(() => {
        if (line && isOpen) {
            const isDiscounted = (line.discountValue ?? 0) > 0;
            const savedDiscount = isDiscounted ? discounts.find(d => d.type === line.discountType && d.value === line.discountValue) : undefined;
            
            reset({
                qtyOrdered: line.qtyOrdered,
                unitPrice: line.unitPrice ?? 0,
                applyDiscount: isDiscounted,
                discountId: savedDiscount?.id || 'custom',
                discountType: normalizeDiscountType(line.discountType),
                discountValue: line.discountValue || 0,
                discountQty: line.discountQty || 0,
                applyFree: (line.freeQty || 0) > 0,
                freeQty: line.freeQty || 0,
                applyVoid: (line.voidedQty || 0) > 0,
                voidQty: line.voidedQty || 0,
                voidReason: undefined,
                voidNote: '',
            });
            
            // Fetch current inventory item details
            if (activeStore && line.itemId) {
                const invItemRef = doc(db, 'stores', activeStore.id, 'inventory', line.itemId);
                getDoc(invItemRef).then(snap => {
                    if (snap.exists()) {
                        const itemData = snap.data() as InventoryItem;
                        setInventoryItem(itemData);
                    }
                }).catch(() => setInventoryItem(null));
            } else {
                setInventoryItem(null);
            }

        }
    }, [line, isOpen, reset, discounts, activeStore]);
    
    const handleQtyChange = (field: 'discountQty' | 'freeQty' | 'voidQty', newValue: number) => {
        const { qtyOrdered, discountQty, freeQty, voidQty } = getValues();
        let currentTotal = (discountQty || 0) + (freeQty || 0) + (voidQty || 0);
        
        const otherTotal = currentTotal - (getValues(field) || 0);
        
        const maxAllowedForThisField = qtyOrdered - otherTotal;

        // Special rule for voiding packages
        if (isPackage && field === 'voidQty' && (newValue >= qtyOrdered)) {
             toast({ variant: 'destructive', title: 'Action Not Allowed', description: 'At least 1 package quantity must remain. Cannot void all.' });
             newValue = qtyOrdered - 1;
        }

        const clampedValue = Math.max(0, Math.min(newValue, maxAllowedForThisField));

        if (clampedValue !== newValue) {
            toast({ variant: 'destructive', title: 'Counts Adjusted', description: 'Allocated quantities cannot exceed total ordered.'});
        }
        
        setValue(field, clampedValue, { shouldValidate: true, shouldDirty: true });

        if (field === 'discountQty') setValue('applyDiscount', clampedValue > 0);
        if (field === 'freeQty') setValue('applyFree', clampedValue > 0);
        if (field === 'voidQty') setValue('applyVoid', clampedValue > 0);
    };

    const handleQtyOrderedChange = (newQty: number) => {
        const { voidQty = 0, freeQty = 0, discountQty = 0 } = getValues();
        const totalAllocated = voidQty + freeQty + discountQty;
        
        if (newQty < totalAllocated) {
            toast({ variant: 'destructive', title: 'Counts Adjusted', description: 'Allocations reduced to match new total quantity.'});
            let excess = totalAllocated - newQty;
            
            let newVoidQty = voidQty;
            let newFreeQty = freeQty;
            let newDiscountQty = discountQty;
            
            if (excess > 0 && newVoidQty > 0) { const reduction = Math.min(excess, newVoidQty); newVoidQty -= reduction; excess -= reduction; }
            if (excess > 0 && newFreeQty > 0) { const reduction = Math.min(excess, newFreeQty); newFreeQty -= reduction; excess -= reduction; }
            if (excess > 0 && newDiscountQty > 0) { const reduction = Math.min(excess, newDiscountQty); newDiscountQty -= reduction; }

            setValue('voidQty', newVoidQty);
            setValue('freeQty', newFreeQty);
            setValue('discountQty', newDiscountQty);
        }
        
        setValue('qtyOrdered', newQty, { shouldValidate: true, shouldDirty: true });
    };

    const handleDiscountIdChange = (id: string) => {
        setValue("discountId", id);
        if (id === 'custom') {
            setValue('discountValue', 0);
            setValue('discountType', 'fixed');
        } else {
            const selected = discounts.find(d => d.id === id);
            if (selected) {
                setValue('discountType', normalizeDiscountType(selected.type));
                setValue('discountValue', Number(selected.value) || 0);
            }
        }
        trigger(["discountValue", "discountType"]);
    };

    const handleSave = async (data: FormValues) => {
        if (!line) return;

        if ((isPackage || isAddon) && data.applyVoid && data.voidQty > 0 && !data.voidReason) {
            toast({
                variant: 'destructive',
                title: 'Reason Required',
                description: 'A reason is required to void items.'
            });
            form.setError("voidReason", { type: "manual", message: "Please select a reason." });
            return;
        }

        const isIncreasingQty = data.qtyOrdered > line.qtyOrdered;
        if ((isPackage || isAddon) && data.qtyOrdered < line.qtyOrdered) {
            toast({
                variant: 'destructive',
                title: 'Cannot Decrease Quantity',
                description: 'Use the "Void Item(s)" option to reduce the quantity.'
            });
            return;
        }
        
        if (isPackage && data.voidQty >= data.qtyOrdered) {
             toast({
                variant: 'destructive',
                title: 'Action Not Allowed',
                description: 'You cannot void all package items. At least 1 must remain.'
            });
            return;
        }

        setIsSubmitting(true);
        const { applyDiscount, applyFree, applyVoid, ...payload } = data;

        if (!applyDiscount) {
            payload.discountQty = 0;
            payload.discountType = null;
            payload.discountValue = 0;
        }
        if (!applyFree) {
            payload.freeQty = 0;
        }
        if (!applyVoid) {
            payload.voidQty = 0;
        }

        const before: Partial<SessionBillLine> = {
            qtyOrdered: line.qtyOrdered,
            discountQty: line.discountQty,
            discountType: line.discountType,
            discountValue: line.discountValue,
            freeQty: line.freeQty,
            voidedQty: line.voidedQty,
            unitPrice: line.unitPrice
        };

        const after: Partial<SessionBillLine> = {
            qtyOrdered: payload.qtyOrdered,
            discountQty: payload.discountQty,
            discountType: payload.discountType,
            discountValue: payload.discountValue,
            freeQty: payload.freeQty,
            voidedQty: payload.voidQty,
            unitPrice: payload.unitPrice,
        };
        
        if (isPackage && isIncreasingQty) {
            (after as any).qtyOverrideActive = true;
            (after as any).qtyOverrideAt = serverTimestamp();
        }

        try {
            onSave(line.id, before, after);
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    const remainingQty = watchedValues.qtyOrdered - ((watchedValues.discountQty || 0) + (watchedValues.freeQty || 0) + (watchedValues.voidQty || 0));
    
    const showSyncPrice = inventoryItem && inventoryItem.sellingPrice !== watchedValues.unitPrice;
    const allowDecimal = inventoryItem ? allowsDecimalQty(inventoryItem.uom) : false;
    const canDecreaseQty = !(isPackage || isAddon);
    
    const maxVoidQty = isPackage ? Math.max(0, watchedValues.qtyOrdered - 1) : watchedValues.qtyOrdered;
    const voidDescription = isPackage 
      ? `of ${watchedValues.qtyOrdered} total. At least 1 must remain.`
      : `of ${watchedValues.qtyOrdered} total`;


    if (!line) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90vh]">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle>Edit: {line.itemName}</DialogTitle>
                </DialogHeader>
                <div className="overflow-y-auto">
                    <div className="p-6">
                        <Form {...form}>
                            <form onSubmit={handleSubmit(handleSave)} id="edit-item-form" className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                     <FormField name="unitPrice" control={control} render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{isPackage ? 'Price Per Head' : 'Unit Price'}</FormLabel>
                                            <div className="flex items-center gap-2">
                                            <FormControl><Input type="number" step="0.01" {...field} readOnly/></FormControl>
                                            {showSyncPrice && (
                                                <Button type="button" size="sm" variant="outline" onClick={() => setValue('unitPrice', inventoryItem?.sellingPrice ?? 0, { shouldDirty: true, shouldValidate: true })}><RefreshCw className="h-4 w-4"/> Sync</Button>
                                            )}
                                            </div>
                                        </FormItem>
                                    )} />
                                    <FormField name="qtyOrdered" control={control} render={({ field }) => (
                                        <QuantityStepper 
                                            label={isPackage ? "Total Covers" : "Total Quantity"} 
                                            value={field.value} 
                                            onChange={handleQtyOrderedChange} 
                                            max={50} 
                                            min={canDecreaseQty ? 0 : line.qtyOrdered}
                                            canDecrease={canDecreaseQty}
                                            allowDecimal={allowDecimal}
                                            step={allowDecimal ? 0.1 : 1}
                                        />
                                    )} />
                                </div>
                                {!canDecreaseQty && <FormDescription className="text-xs -mt-2">Decrease not allowed. Use Void option to reduce billed items.</FormDescription>}
                                <Alert>
                                    <AlertTitle>Remaining to Allocate: {remainingQty.toFixed(allowDecimal ? 2 : 0)}</AlertTitle>
                                </Alert>

                                <Separator />
                                {/* Discount Section */}
                                <div className="space-y-2">
                                    <FormField name="applyDiscount" control={control} render={({ field }) => (
                                        <FormItem className="flex items-center gap-2 space-y-0"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLocked}/></FormControl><FormLabel>Apply Discount</FormLabel></FormItem>
                                    )} />
                                    {watchedValues.applyDiscount && (
                                        <div className="p-3 border rounded-md space-y-2">
                                            <FormField name="discountQty" control={control} render={({ field }) => (
                                                <QuantityStepper label="Apply to" value={field.value || 0} onChange={(v) => handleQtyChange('discountQty', v)} max={watchedValues.qtyOrdered || line.qtyOrdered} description={`of ${watchedValues.qtyOrdered} total items`}/>
                                            )} />
                                            <FormField name="discountId" control={control} render={({ field }) => (
                                                <FormItem><FormLabel>Preset</FormLabel><Select onValueChange={handleDiscountIdChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a preset..." /></SelectTrigger></FormControl><SelectContent><SelectItem value="custom">Custom</SelectItem>{discounts.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></FormItem>
                                            )} />
                                            <div className="grid grid-cols-2 gap-2">
                                                <FormField name="discountType" control={control} render={({ field }) => (
                                                    <FormItem><FormLabel>Type</FormLabel><Select onValueChange={field.onChange} value={field.value || ""} disabled={isLocked}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="fixed">₱</SelectItem><SelectItem value="percent">%</SelectItem></SelectContent></Select></FormItem>
                                                )} />
                                                <FormField name="discountValue" control={control} render={({ field }) => (
                                                    <FormItem><FormLabel>Value</FormLabel><FormControl><Input type="number" {...field} disabled={watchedValues.discountId !== 'custom'}/></FormControl><FormMessage/></FormItem>
                                                )} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                
                                <Separator />
                                {/* Free Section */}
                                <div className="space-y-2">
                                    <FormField name="applyFree" control={control} render={({ field }) => (
                                        <FormItem className="flex items-center gap-2 space-y-0"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLocked}/></FormControl><FormLabel>Mark as Free</FormLabel></FormItem>
                                    )} />
                                    {watchedValues.applyFree && (
                                        <div className="p-3 border rounded-md">
                                            <FormField name="freeQty" control={control} render={({ field }) => (
                                            <QuantityStepper label="Apply to" value={field.value || 0} onChange={(v) => handleQtyChange('freeQty', v)} max={watchedValues.qtyOrdered || line.qtyOrdered} description={`of ${watchedValues.qtyOrdered} total items`}/>
                                            )} />
                                        </div>
                                    )}
                                </div>
                                    
                                <Separator />
                                <div className="space-y-2">
                                    <FormField name="applyVoid" control={control} render={({ field }) => (
                                        <FormItem className="flex items-center gap-2 space-y-0"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLocked}/></FormControl><FormLabel>{isPackage ? "Void Covers" : "Void Item(s)"}</FormLabel></FormItem>
                                    )} />
                                    {watchedValues.applyVoid && (
                                        <div className="p-3 border rounded-md space-y-2">
                                            <FormField name="voidQty" control={control} render={({ field }) => (
                                                <QuantityStepper 
                                                    label="Void Quantity" 
                                                    value={field.value || 0} 
                                                    onChange={(v) => handleQtyChange('voidQty', v)} 
                                                    max={maxVoidQty}
                                                    description={voidDescription}
                                                />
                                            )} />
                                            <FormField name="voidReason" control={control} render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Reason {(isPackage || isAddon) && <span className="text-destructive">*</span>}</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a reason..."/></SelectTrigger></FormControl><SelectContent>{Object.entries(VOID_REASONS).map(([key, val]) => <SelectItem key={key} value={key}>{val}</SelectItem>)}</SelectContent></Select>
                                                    <FormMessage/>
                                                </FormItem>
                                            )} />
                                            {watchedValues.voidReason === 'other' && (
                                                <FormField name="voidNote" control={control} render={({ field }) => (
                                                    <FormItem><FormLabel>Note</FormLabel><FormControl><Textarea {...field}/></FormControl></FormItem>
                                                )} />
                                            )}
                                        </div>
                                    )}
                                </div>
                                
                            </form>
                        </Form>
                    </div>
                </div>
                <DialogFooter className="p-6 pt-0">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
                    <Button type="submit" form="edit-item-form" disabled={isSubmitting || isLocked}>
                         {isSubmitting ? <Loader2 className="animate-spin" /> : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
