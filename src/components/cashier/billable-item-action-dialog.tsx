
"use client";

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GroupedBillableItem } from "@/app/cashier/page";
import { useToast } from "@/hooks/use-toast";
import { QuantityInput } from "./quantity-input";
import { type Discount } from "@/app/manager/collections/_components/DiscountsSettings";
import { Minus, Plus } from "lucide-react";

type ActionType = "discount" | "free";

interface BillableItemActionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    group: GroupedBillableItem;
    actionType: ActionType;
    discounts: Discount[];
    onApplyDiscount: (ticketIds: string[], discountType: "fixed" | "percentage", discountValue: number, quantity: number) => void;
    onApplyFree: (ticketIds: string[], quantity: number, currentIsFree: boolean) => void;
}

function CurrencyInput({ value, onChange, disabled, className }: { value: number, onChange: (val: number) => void, disabled?: boolean, className?: string }) {
    const [displayValue, setDisplayValue] = useState(value.toString());

    useEffect(() => {
        setDisplayValue(value.toString());
    }, [value]);

    const handleFocus = () => {
        if (parseFloat(displayValue) === 0) {
            setDisplayValue("");
        }
    };

    const handleBlur = () => {
        if (displayValue === "" || isNaN(parseFloat(displayValue))) {
            setDisplayValue("0");
            onChange(0);
        } else {
            onChange(parseFloat(displayValue));
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setDisplayValue(e.target.value);
    };

    const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const numVal = parseFloat(displayValue);
        if (!isNaN(numVal)) {
            onChange(numVal);
        }
    }
    
    return (
        <Input 
            type="number" 
            placeholder="Value"
            value={displayValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyUp={handleKeyUp}
            disabled={disabled}
            className={className}
        />
    )
}

function normalizeDiscountType(t: any): "fixed" | "percentage" {
    if (t === "percentage" || t === "percent") return "percentage";
    return "fixed";
}


export function BillableItemActionDialog({ isOpen, onClose, group, actionType, discounts, onApplyDiscount, onApplyFree }: BillableItemActionDialogProps) {
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isCustom, setIsCustom] = useState(true);
    
    const formSchema = z.object({
        discountId: z.string().optional(),
        discountType: z.enum(["fixed", "percentage"]),
        discountValue: z.coerce.number().min(0, "Value must be positive."),
        quantity: z.coerce.number().int().min(1).max(group.servedQty, `Cannot exceed served quantity (${group.servedQty}).`)
    });
    
    type FormValues = z.infer<typeof formSchema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            discountId: "custom",
            discountType: "fixed",
            discountValue: 0,
            quantity: group.servedQty,
        },
    });

    const quantity = form.watch('quantity');

    useEffect(() => {
        if (isOpen) {
            form.reset({
                discountId: "custom",
                discountType: actionType === 'free' ? 'fixed' : 'fixed',
                discountValue: actionType === 'free' ? group.unitPrice : 0,
                quantity: group.servedQty,
            });
            setIsCustom(true);
        }
    }, [isOpen, group, form, actionType]);
    
    const handleDiscountSelect = (id: string) => {
        if (id === 'custom') {
            setIsCustom(true);
            form.setValue('discountValue', 0);
            form.setValue('discountType', 'fixed');
        } else {
            setIsCustom(false);
            const selected = discounts.find(d => d.id === id);
            if (selected) {
                const normalizedType = normalizeDiscountType(selected.type);
                const normalizedValue = Number(selected.value) || 0;
                form.setValue('discountType', normalizedType);
                form.setValue('discountValue', normalizedValue);
            }
        }
    };


    const handleSubmit = (data: FormValues) => {
        setIsSubmitting(true);
        try {
            if (group.lineDiscountValue > 0 || group.isFree) {
                 toast({ variant: "destructive", title: "Discount already applied", description: "This item already has a discount. Please remove it first." });
                 onClose();
                 return;
            }
            
            const safeType = normalizeDiscountType(data.discountType);
            const safeValue = Number(data.discountValue) || 0;

            if (actionType === 'discount') {
                onApplyDiscount(group.ticketIds, safeType, safeValue, data.quantity);
                toast({ title: "Discount Applied" });
            } else { // 'free'
                onApplyFree(group.ticketIds, data.quantity, false);
                toast({ title: "Item(s) Marked as Free" });
            }
            onClose();
        } catch (error: any) {
            toast({ variant: "destructive", title: "Failed to apply action", description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    const dialogTitle = actionType === 'discount' 
        ? `Apply Discount to ${group.itemName}`
        : `Mark ${group.itemName} as Free`;
    
    const dialogDescription = actionType === 'discount'
        ? "Set a fixed or percentage discount for one or more served items in this group."
        : "Select how many served items in this group should be marked as free.";

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{dialogTitle}</DialogTitle>
                    <DialogDescription>{dialogDescription}</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} id="action-form" className="space-y-4 py-4">
                        
                        {/* Discount fields */}
                        {actionType === "discount" && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                            {/* ROW 1 - COL 1: APPLY TO (always rendered, disabled when not grouped) */}
                            <FormField
                              control={form.control}
                              name="quantity"
                              render={({ field }) => {
                                const canAdjustQty = group.isGrouped && group.servedQty > 1;

                                return (
                                  <FormItem className="w-full">
                                    <FormLabel>Apply to</FormLabel>
                                    <FormControl>
                                      <div className="grid grid-cols-[40px,1fr,40px] gap-2 w-full items-center">
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="icon"
                                          disabled={!canAdjustQty}
                                          onClick={() => form.setValue("quantity", Math.max(1, quantity - 1))}
                                        >
                                          <Minus />
                                        </Button>

                                        <QuantityInput
                                          value={field.value}
                                          onChange={field.onChange}
                                          className="w-full text-center"
                                          disabled={!canAdjustQty}
                                        />

                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="icon"
                                          disabled={!canAdjustQty}
                                          onClick={() => form.setValue("quantity", Math.min(group.servedQty, quantity + 1))}
                                        >
                                          <Plus />
                                        </Button>
                                      </div>
                                    </FormControl>

                                    {group.isGrouped && (
                                      <FormDescription className="text-xs">
                                        of {group.servedQty} served items.
                                      </FormDescription>
                                    )}
                                    <FormMessage />
                                  </FormItem>
                                );
                              }}
                            />

                            {/* ROW 1 - COL 2: SELECT DISCOUNT */}
                            <FormField
                              control={form.control}
                              name="discountId"
                              render={({ field }) => (
                                <FormItem className="w-full">
                                  <FormLabel>Select Discount</FormLabel>
                                  <Select
                                    onValueChange={(id) => {
                                      field.onChange(id);
                                      handleDiscountSelect(id);
                                    }}
                                    value={field.value}
                                  >
                                    <FormControl>
                                      <SelectTrigger className="w-full">
                                        <SelectValue />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="custom">Others (Custom)</SelectItem>
                                      {discounts.map((d) => (
                                        <SelectItem key={d.id} value={d.id}>
                                          {d.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />

                            {/* ROW 2 - COL 1: TYPE (₱ / %) */}
                            <FormField
                              control={form.control}
                              name="discountType"
                              render={({ field }) => (
                                <FormItem className="w-full">
                                  <FormLabel>Type</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value} disabled={!isCustom}>
                                    <FormControl>
                                      <SelectTrigger className="w-full">
                                        <SelectValue />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="fixed">₱ (Fixed)</SelectItem>
                                      <SelectItem value="percentage">% (Percent)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />

                            {/* ROW 2 - COL 2: VALUE */}
                            <FormField
                              control={form.control}
                              name="discountValue"
                              render={({ field }) => (
                                <FormItem className="w-full">
                                  <FormLabel>Value</FormLabel>
                                  <FormControl>
                                    <CurrencyInput
                                      value={field.value}
                                      onChange={field.onChange}
                                      className="w-full"
                                      disabled={!isCustom}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        )}

                        {actionType === 'free' && (
                             <FormField
                                control={form.control}
                                name="quantity"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Apply to</FormLabel>
                                        <FormControl>
                                            <div className="flex items-center gap-2">
                                                <Button type="button" variant="outline" size="icon" onClick={() => form.setValue('quantity', Math.max(1, quantity - 1))}><Minus/></Button>
                                                <QuantityInput 
                                                    value={field.value}
                                                    onChange={field.onChange}
                                                    className="text-center"
                                                />
                                                <Button type="button" variant="outline" size="icon" onClick={() => form.setValue('quantity', Math.min(group.servedQty, quantity + 1))}><Plus/></Button>
                                            </div>
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            of {group.servedQty} served items.
                                        </FormDescription>
                                        <FormMessage/>
                                    </FormItem>
                                )}
                            />
                        )}

                    </form>
                </Form>
                <DialogFooter>
                    <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
                    <Button type="submit" form="action-form" disabled={isSubmitting}>
                        {isSubmitting ? "Applying..." : "Apply Action"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
