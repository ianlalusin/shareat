
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2 } from "lucide-react";

const VOID_REASONS = {
  wrong_item: "Wrong Item Ordered",
  customer_request: "Customer Changed Mind / Cancelled",
  duplicate_entry: "Duplicate Entry Error",
  pricing_error: "Pricing Error",
  other: "Other",
};
type VoidReasonKey = keyof typeof VOID_REASONS;

const formSchema = z.object({
  reason: z.string({ required_error: "Please select a reason." }),
  note: z.string().optional(),
}).refine(data => !(data.reason === 'other' && (!data.note || data.note.trim() === '')), {
    message: "A note is required when the reason is 'Other'.",
    path: ["note"],
});

type FormValues = z.infer<typeof formSchema>;

interface VoidItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  itemName: string;
  onConfirm: (reason: string, note?: string) => void;
}

export function VoidItemDialog({ isOpen, onClose, itemName, onConfirm }: VoidItemDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { reason: "", note: "" },
  });

  const watchedReason = form.watch("reason");

  const handleSubmit = (data: FormValues) => {
    setIsSubmitting(true);
    onConfirm(data.reason, data.note);
    // The parent component will handle closing and toast messages
    // to allow for async operations.
    // setIsSubmitting will be reset when the dialog unmounts or reopens.
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void Item: {itemName}</DialogTitle>
          <DialogDescription>Select a reason for voiding this item from the bill. This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} id="void-form" className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a reason..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(VOID_REASONS).map(([key, value]) => (
                        <SelectItem key={key} value={key}>{value}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {watchedReason === 'other' && (
              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Details</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Please provide specific details..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </form>
        </Form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button variant="destructive" type="submit" form="void-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Void
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
