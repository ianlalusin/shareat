
"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Printer } from "lucide-react";
import type { Store } from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import { useReceiptSettings } from "@/hooks/use-receipt-settings";
import { receiptSettingsSchema, type ReceiptSettingsFormValues } from "@/lib/receipts/receipt-settings";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

const fontOptions = [
    { name: "Courier New", value: "'Courier New', Courier, monospace" },
    { name: "Lucida Console", value: "'Lucida Console', Monaco, monospace" },
    { name: "Monospace", value: "monospace" },
    { name: "Sans-Serif", value: "sans-serif" },
    { name: "Serif", value: "serif" },
];

interface ReceiptSettingsProps {
    store: Store;
    onTestPrint?: () => void;
    onClose?: () => void;
}

export function ReceiptSettings({ store, onTestPrint, onClose }: ReceiptSettingsProps) {
  const { appUser } = useAuthContext();
  const { toast } = useToast();
  const { settings, isLoading: settingsLoading } = useReceiptSettings(store.id);

  const form = useForm<ReceiptSettingsFormValues>({
    resolver: zodResolver(receiptSettingsSchema),
    defaultValues: settings,
  });

  useEffect(() => {
    // Only reset the form if the settings have loaded and the form is not currently being submitted.
    // This prevents a race condition where a save is in progress but new data comes in.
    if (settings && !form.formState.isSubmitting) {
        form.reset(settings);
    }
  }, [settings, form]); // depends on `form` to get `formState`
  
  const isSubmitting = form.formState.isSubmitting;

  const onSubmit = async (data: ReceiptSettingsFormValues) => {
    if (!appUser) return;
    const settingsRef = doc(db, `stores/${store.id}/receiptSettings`, "main");
    try {
      await setDoc(settingsRef, { ...data, updatedAt: serverTimestamp() }, { merge: true });
      toast({ title: "Receipt Settings Saved" });
      onClose?.();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save Failed", description: error.message });
    }
  };
  
  if (settingsLoading) {
      return <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin" /></div>
  }

  return (
    <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold">Store Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="businessName" render={({ field }) => <FormItem><FormLabel>Business Name</FormLabel><FormControl><Input placeholder="e.g., SharEat" {...field} /></FormControl><FormMessage /></FormItem>} />
                    <FormField control={form.control} name="branchName" render={({ field }) => <FormItem><FormLabel>Branch Name</FormLabel><FormControl><Input placeholder="e.g., Malvar" {...field} /></FormControl><FormMessage /></FormItem>} />
                    <FormField control={form.control} name="address" render={({ field }) => <FormItem><FormLabel>Address</FormLabel><FormControl><Input placeholder="e.g., Calle Arzobispado" {...field} /></FormControl><FormMessage /></FormItem>} />
                    <FormField control={form.control} name="contact" render={({ field }) => <FormItem><FormLabel>Contact</FormLabel><FormControl><Input placeholder="e.g., +639..." {...field} /></FormControl><FormMessage /></FormItem>} />
                    <FormField control={form.control} name="tin" render={({ field }) => <FormItem><FormLabel>TIN (optional)</FormLabel><FormControl><Input placeholder="000-000-000" {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>} />
                </div>
            </div>

            <div className="space-y-4 p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Display Options</h3>
                    {onTestPrint && (
                        <Button type="button" variant="outline" size="sm" onClick={onTestPrint}>
                            <Printer className="mr-2 h-4 w-4" /> Print Test Receipt
                        </Button>
                    )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <FormField control={form.control} name="showLogo" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Logo</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showCashierName" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Cashier</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showTableOrCustomer" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Table/Customer</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showItemNotes" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Item Notes</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showDiscountBreakdown" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Discount Breakdown</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    <FormField control={form.control} name="showChargeBreakdown" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Show Charge Breakdown</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                </div>
            </div>

            <div className="space-y-4 p-4 border rounded-lg">
                <h3 className="font-semibold">Formatting & Style</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                       <FormField control={form.control} name="paperWidth" render={({ field }) => (
                            <FormItem className="space-y-3">
                                <FormLabel>Paper Width</FormLabel>
                                <FormControl>
                                    <RadioGroup
                                        onValueChange={field.onChange}
                                        value={field.value}
                                        className="flex items-center space-x-4"
                                    >
                                        <FormItem className="flex items-center space-x-2 space-y-0">
                                            <FormControl><RadioGroupItem value="58mm" id="r1" /></FormControl>
                                            <Label htmlFor="r1" className="font-normal">58mm</Label>
                                        </FormItem>
                                        <FormItem className="flex items-center space-x-2 space-y-0">
                                            <FormControl><RadioGroupItem value="80mm" id="r2" /></FormControl>
                                            <Label htmlFor="r2" className="font-normal">80mm</Label>
                                        </FormItem>
                                    </RadioGroup>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <FormField control={form.control} name="receiptNoFormat" render={({ field }) => <FormItem><FormLabel>Receipt No. Format</FormLabel><FormControl><Input placeholder="e.g., SEV5-{YYYY}-{####}" {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>} />
                        <FormField control={form.control} name="footerText" render={({ field }) => <FormItem><FormLabel>Footer Text</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl><FormMessage /></FormItem>} />
                        <FormField control={form.control} name="autoPrintAfterPayment" render={({ field }) => <FormItem className="flex items-center justify-between rounded-lg border p-3"><FormLabel>Auto-print after payment</FormLabel><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>} />
                    </div>
                     <div className="space-y-4">
                        <FormField control={form.control} name="logoWidthPct" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Logo Width: {field.value ?? 80}%</FormLabel>
                                <FormControl>
                                    <Slider
                                        value={[field.value ?? 80]}
                                        onValueChange={(value) => field.onChange(value[0])}
                                        min={20}
                                        max={100}
                                        step={10}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <FormField control={form.control} name="fontSize" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Font Size: {field.value ?? 12}px</FormLabel>
                                <FormControl>
                                    <Slider
                                        value={[field.value ?? 12]}
                                        onValueChange={(value) => field.onChange(value[0])}
                                        min={8}
                                        max={16}
                                        step={1}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <FormField control={form.control} name="fontFamily" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Font Family</FormLabel>
                                <FormControl>
                                    <div className="flex flex-wrap gap-2 pt-2">
                                        {fontOptions.map((opt) => (
                                            <Badge
                                                key={opt.name}
                                                variant={field.value === opt.value ? "default" : "outline"}
                                                onClick={() => field.onChange(opt.value)}
                                                className="cursor-pointer text-base"
                                                style={{ fontFamily: opt.value }}
                                            >
                                                {opt.name}
                                            </Badge>
                                        ))}
                                    </div>
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                    </div>
                </div>
            </div>

            <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 animate-spin" />}
                    Save Settings
                </Button>
            </div>
        </form>
    </Form>
  );
}

    