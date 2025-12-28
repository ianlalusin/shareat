
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

interface BillableItemDiscountDialogProps {
    isOpen: boolean;
    onClose: () => void;
    group: GroupedBillableItem;
    onApply: (ticketIds: string[], discountType: "fixed" | "percentage", discountValue: number, quantity: number) => void;
}

export function BillableItemDiscountDialog({ isOpen, onClose, group, onApply }: BillableItemDiscountDialogProps) {
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const formSchema = z.object({
        discountType: z.enum(["fixed", "percentage"]),
        discountValue: z.coerce.number().min(0, "Discount must be positive."),
        quantity: z.coerce.number().int().min(1).max(group.servedQty, `Cannot exceed served quantity in group (${group.servedQty}).`)
    });
    
    type FormValues = z.infer<typeof formSchema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            discountType: "fixed",
            discountValue: 0,
            quantity: group.servedQty,
        },
    });

    useEffect(() => {
        if (isOpen) {
            form.reset({
                discountType: "fixed",
                discountValue: 0,
                quantity: group.servedQty,
            });
        }
    }, [isOpen, group, form]);


    const handleSubmit = (data: FormValues) => {
        setIsSubmitting(true);
        try {
            onApply(group.ticketIds, data.discountType, data.discountValue, data.quantity);
            toast({ title: "Discount Applied" });
            onClose();
        } catch (error: any) {
            toast({ variant: "destructive", title: "Failed to apply discount", description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Apply Discount to {group.itemName}</DialogTitle>
                    <DialogDescription>
                        Set a fixed or percentage discount for one or more served items in this group.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} id="discount-form" className="space-y-4 py-4">
                        <div className="flex items-end gap-2">
                             <FormField
                                control={form.control}
                                name="discountType"
                                render={({ field }) => (
                                <FormItem className="w-24">
                                    <FormLabel>Type</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="fixed">₱ (Fixed)</SelectItem>
                                            <SelectItem value="percentage">% (Percent)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="discountValue"
                                render={({ field }) => (
                                    <FormItem className="flex-1">
                                        <FormLabel>Value</FormLabel>
                                        <FormControl>
                                            <Input type="number" {...field} />
                                        </FormControl>
                                        <FormMessage/>
                                    </FormItem>
                                )}
                            />
                        </div>
                        {group.isGrouped && (
                             <FormField
                                control={form.control}
                                name="quantity"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Apply to How Many?</FormLabel>
                                        <FormControl>
                                             <Input type="number" {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            Applying to {field.value} of {group.servedQty} served items.
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
                    <Button type="submit" form="discount-form" disabled={isSubmitting}>
                        {isSubmitting ? "Applying..." : "Apply Discount"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
