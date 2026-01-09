
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
import { Minus, Plus, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { BillableLine, Discount, KitchenTicket } from "@/lib/types";
import { getEligibleTicketIds } from "./billable-lines";

const VOID_REASONS = {
  wrong_item: "Wrong Item Ordered",
  customer_request: "Customer Changed Mind / Cancelled",
  duplicate_entry: "Duplicate Entry Error",
  pricing_error: "Pricing Error",
  other: "Other",
};

const formSchema = z.object({
  unitPrice: z.coerce.number().min(0),
  
  applyDiscount: z.boolean().default(false),
  discountId: z.string().optional(),
  discountType: z.enum(["fixed", "percent"]).default("fixed"),
  discountValue: z.coerce.number().min(0).default(0),
  discountQty: z.coerce.number().min(1),

  applyFree: z.boolean().default(false),
  freeQty: z.coerce.number().min(1),
  
  applyVoid: z.boolean().default(false),
  voidQty: z.coerce.number().min(1),
  voidReason: z.string().optional(),
  voidNote: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface EditBillableItemDialogProps {
    isOpen: boolean;
    onClose: () => void;
    line: BillableLine;
    tickets: Map<string, KitchenTicket>;
    discounts: Discount[];
    isLocked?: boolean;
    onUpdateQty: (lineId: string, newQty: number) => void;
    onUpdateUnitPrice: (lineId: string, newPrice: number) => Promise<void>;
    onApplyDiscount: (lineId: string, discountType: "fixed" | "percent", discountValue: number, quantity: number) => void;
    onApplyFree: (lineId: string, quantity: number, currentIsFree: boolean) => void;
    onVoidItem: (lineId: string, quantity: number, reason: string, note?: string) => void;
}

function normalizeDiscountType(t: any): "fixed" | "percent" {
    if (t === "percentage" || t === "percent") return "percent";
    return "fixed";
}

function QuantityStepper({ label, value, onChange, max, min = 1, description }: { label: string, value: number, onChange: (val: number) => void, max: number, min?: number, description?: string }) {
    return (
        <FormItem>
            <FormLabel>{label}</FormLabel>
            <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon" onClick={() => onChange(Math.max(min, value - 1))}><Minus/></Button>
                <QuantityInput 
                    value={value}
                    onChange={onChange}
                    className="text-center"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => onChange(Math.min(max, value + 1))}><Plus/></Button>
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
    tickets,
    discounts, 
    isLocked, 
    onUpdateQty, 
    onUpdateUnitPrice, 
    onApplyDiscount, 
    onApplyFree, 
    onVoidItem,
}: EditBillableItemDialogProps) {
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const servedQty = useMemo(() => getEligibleTicketIds(line, tickets, 'served').length, [line, tickets]);
    const pendingQty = useMemo(() => getEligibleTicketIds(line, tickets, 'pending').length, [line, tickets]);
    const totalActionableQty = servedQty + pendingQty;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
    });
    
    useEffect(() => {
        if (line) {
            const isDiscounted = (line.discountValue ?? 0) > 0;
            const savedDiscount = isDiscounted ? discounts.find(d => d.type === line.discountType && d.value === line.discountValue) : undefined;
            const defaultActionQty = servedQty > 0 ? servedQty : 1;
            
            form.reset({
                unitPrice: line.unitPrice,
                applyDiscount: isDiscounted,
                discountId: savedDiscount?.id || 'custom',
                discountType: line.discountType || 'fixed',
                discountValue: line.discountValue || 0,
                discountQty: defaultActionQty,
                applyFree: line.isFree,
                freeQty: defaultActionQty,
                applyVoid: false,
                voidQty: 1,
                voidReason: undefined,
                voidNote: '',
            });
        }
    }, [line, discounts, servedQty, form, isOpen]);

    const { applyDiscount, discountId, applyFree, applyVoid, voidReason } = form.watch();

    const handleDiscountIdChange = (id: string) => {
        form.setValue("discountId", id);
        if (id === 'custom') {
            form.setValue('discountValue', 0);
            form.setValue('discountType', 'fixed');
        } else {
            const selected = discounts.find(d => d.id === id);
            if (selected) {
                form.setValue('discountType', normalizeDiscountType(selected.type));
                form.setValue('discountValue', Number(selected.value) || 0);
            }
        }
    };

    const handleSave = async (data: FormValues) => {
        setIsSubmitting(true);
        try {
            if (data.unitPrice !== line.unitPrice) {
                await onUpdateUnitPrice(line.id, data.unitPrice);
            }
            if (data.applyDiscount) {
                onApplyDiscount(line.id, data.discountType, data.discountValue, data.discountQty);
            } else if (!data.applyDiscount && (line.discountValue ?? 0) > 0) {
                 onApplyDiscount(line.id, 'fixed', 0, line.qty);
            }
            
            if (data.applyFree !== line.isFree) {
                onApplyFree(line.id, data.freeQty, line.isFree ?? false);
            }

            if (data.applyVoid) {
                if (!data.voidReason) {
                    toast({ variant: 'destructive', title: 'Void reason is required' });
                    setIsSubmitting(false);
                    return;
                }
                onVoidItem(line.id, data.voidQty, data.voidReason, data.voidNote);
            }
            toast({ title: "Changes Applied" });
            onClose();

        } catch (error: any) {
            toast({ variant: "destructive", title: "Failed to apply changes", description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Edit: {line.itemName}</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSave)} id="edit-item-form" className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <FormField name="qty" control={form.control} render={({ field }) => (
                                <FormItem><FormLabel>Total Quantity</FormLabel><Input type="number" readOnly disabled value={line.qty} /></FormItem>
                            )} />
                            <FormField name="unitPrice" control={form.control} render={({ field }) => (
                                <FormItem><FormLabel>Unit Price</FormLabel><FormControl><Input type="number" step="0.01" {...field} disabled={isLocked}/></FormControl><FormMessage/></FormItem>
                            )} />
                        </div>
                        <Separator />
                        <div className="space-y-2">
                            <FormField name="applyDiscount" control={form.control} render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLocked || servedQty === 0}/></FormControl><FormLabel>Apply Discount</FormLabel></FormItem>
                            )} />
                            {applyDiscount && (
                                <div className="p-3 border rounded-md space-y-2">
                                    <FormField name="discountQty" control={form.control} render={({ field }) => (
                                        <QuantityStepper label="Apply to" value={field.value} onChange={field.onChange} max={servedQty} description={`of ${servedQty} served items`}/>
                                     )} />
                                     <FormField name="discountId" control={form.control} render={({ field }) => (
                                        <FormItem><FormLabel>Preset</FormLabel><Select onValueChange={handleDiscountIdChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a preset..." /></SelectTrigger></FormControl><SelectContent><SelectItem value="custom">Custom</SelectItem>{discounts.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent></Select></FormItem>
                                     )} />
                                     <div className="grid grid-cols-2 gap-2">
                                        <FormField name="discountType" control={form.control} render={({ field }) => (
                                            <FormItem><FormLabel>Type</FormLabel><Select onValueChange={field.onChange} value={field.value} disabled={discountId !== 'custom'}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="fixed">₱</SelectItem><SelectItem value="percent">%</SelectItem></SelectContent></Select></FormItem>
                                        )} />
                                        <FormField name="discountValue" control={form.control} render={({ field }) => (
                                            <FormItem><FormLabel>Value</FormLabel><FormControl><Input type="number" {...field} disabled={discountId !== 'custom'}/></FormControl><FormMessage/></FormItem>
                                        )} />
                                     </div>
                                </div>
                            )}
                        </div>
                        <Separator />
                        <div className="space-y-2">
                             <FormField name="applyFree" control={form.control} render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLocked || servedQty === 0}/></FormControl><FormLabel>Mark as Free</FormLabel></FormItem>
                            )} />
                            {applyFree && (
                                 <div className="p-3 border rounded-md">
                                    <FormField name="freeQty" control={form.control} render={({ field }) => (
                                       <QuantityStepper label="Apply to" value={field.value} onChange={field.onChange} max={servedQty} description={`of ${servedQty} served items`}/>
                                     )} />
                                 </div>
                            )}
                        </div>
                        <Separator />
                        <div className="space-y-2">
                            <FormField name="applyVoid" control={form.control} render={({ field }) => (
                                <FormItem className="flex items-center gap-2 space-y-0"><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLocked || totalActionableQty === 0}/></FormControl><FormLabel>Void Item(s)</FormLabel></FormItem>
                            )} />
                            {applyVoid && (
                                 <div className="p-3 border rounded-md space-y-2">
                                     <FormField name="voidQty" control={form.control} render={({ field }) => (
                                        <QuantityStepper label="Void Quantity" value={field.value} onChange={field.onChange} max={totalActionableQty} description={`of ${totalActionableQty} total items (pending items first)`}/>
                                     )} />
                                     <FormField name="voidReason" control={form.control} render={({ field }) => (
                                        <FormItem><FormLabel>Reason</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a reason..."/></SelectTrigger></FormControl><SelectContent>{Object.entries(VOID_REASONS).map(([key, val]) => <SelectItem key={key} value={key}>{val}</SelectItem>)}</SelectContent></Select><FormMessage/></FormItem>
                                     )} />
                                     {voidReason === 'other' && (
                                         <FormField name="voidNote" control={form.control} render={({ field }) => (
                                            <FormItem><FormLabel>Note</FormLabel><FormControl><Textarea {...field}/></FormControl></FormItem>
                                         )} />
                                     )}
                                </div>
                            )}
                        </div>
                    </form>
                </Form>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
                    <Button type="submit" form="edit-item-form" disabled={isSubmitting || isLocked}>
                         {isSubmitting ? <Loader2 className="animate-spin" /> : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
