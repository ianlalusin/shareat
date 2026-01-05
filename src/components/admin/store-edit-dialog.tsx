
"use client";

import { useEffect, useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { CalendarIcon, UploadCloud, Image as ImageIcon } from "lucide-react";
import Image from "next/image";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { Store } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useToast } from "@/hooks/use-toast";
import { uploadStoreLogo } from "@/lib/firebase/client";
import { Timestamp } from "firebase/firestore";

const formSchema = z.object({
  name: z.string().min(2, "Store name must be at least 2 characters."),
  code: z.string().min(2, "Code must be at least 2 characters.").max(10, "Code cannot be more than 10 characters.").toUpperCase(),
  address: z.string().min(5, "Address is required."),
  tin: z.string().optional(),
  vatType: z.enum(["VAT", "NON_VAT"]).optional(),
  logoUrl: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
  email: z.string().email("Invalid email address.").optional().or(z.literal('')),
  contactNumber: z.string().optional(),
  openingDate: z.date().optional().nullable(),
});

type StoreFormValues = z.infer<typeof formSchema>;

interface StoreEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: StoreFormValues) => void;
  store: Store | null;
  isSubmitting: boolean;
}

function toJsDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v?.toDate === "function") return v.toDate(); // Handle other timestamp-like objects
   if (typeof v === 'object' && 'seconds' in v && 'nanoseconds' in v) {
    const d = new Date(v.seconds * 1000 + v.nanoseconds / 1000000);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "number" || typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}


export function StoreEditDialog({ isOpen, onClose, onSave, store, isSubmitting }: StoreEditDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  
  const form = useForm<StoreFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", code: "", address: "", tin: "", isActive: true,
      email: "", contactNumber: "", openingDate: null,
      logoUrl: null, vatType: "NON_VAT"
    },
  });

  const logoUrl = form.watch("logoUrl");

  useEffect(() => {
    if (store) {
      form.reset({
        name: store.name, code: store.code, address: store.address,
        tin: store.tin || "", isActive: store.isActive,
        email: store.email || "", contactNumber: store.contactNumber || "",
        openingDate: toJsDate(store.openingDate),
        logoUrl: store.logoUrl || null,
        vatType: store.vatType || "NON_VAT",
      });
    } else {
      form.reset({
        name: "", code: "", address: "", tin: "", isActive: true,
        email: "", contactNumber: "", openingDate: null,
        logoUrl: null, vatType: "NON_VAT",
      });
    }
  }, [store, form, isOpen]);

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!store) {
        toast({ variant: 'destructive', title: "Save Store First", description: "You must save the new store before uploading a logo."});
        return;
    };
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        const url = await uploadStoreLogo(store.id, file);
        form.setValue("logoUrl", url);
        toast({ title: "Logo Uploaded" });
    } catch (error: any) {
        toast({ variant: "destructive", title: "Upload Failed", description: error.message });
    }
  };


  const onSubmit = (data: StoreFormValues) => {
    onSave(data);
  };
  
  const dialogTitle = store ? "Edit Store" : "Create New Store";
  const dialogDescription = store ? "Update the details of this store." : "Fill in the details to create a new store.";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90vh]">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto">
          <div className="p-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} id="store-form-id" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="name" render={({ field }) => ( <FormItem><FormLabel>Store Name</FormLabel><FormControl><Input placeholder="e.g., Main Branch" {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="code" render={({ field }) => ( <FormItem><FormLabel>Store Code</FormLabel><FormControl><Input placeholder="e.g., MAIN" {...field} /></FormControl><FormMessage /></FormItem> )} />
                </div>
                <FormField control={form.control} name="address" render={({ field }) => ( <FormItem><FormLabel>Address</FormLabel><FormControl><Input placeholder="e.g., 123 Main St, Anytown" {...field} /></FormControl><FormMessage /></FormItem> )} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="contactNumber" render={({ field }) => ( <FormItem><FormLabel>Contact Number</FormLabel><FormControl><Input placeholder="e.g., +1 234 567 890" {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="email" render={({ field }) => ( <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" placeholder="e.g., contact@store.com" {...field} /></FormControl><FormMessage /></FormItem> )} />
                </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField control={form.control} name="tin" render={({ field }) => ( <FormItem><FormLabel>TIN</FormLabel><FormControl><Input placeholder="e.g., 123-456-789-000" {...field} /></FormControl><FormMessage /></FormItem> )} />
                    <FormField control={form.control} name="vatType" render={({ field }) => ( <FormItem><FormLabel>VAT Type</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="VAT">VAT</SelectItem><SelectItem value="NON_VAT">Non-VAT</SelectItem></SelectContent></Select><FormMessage /></FormItem> )} />
                </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                    <FormField
                        control={form.control}
                        name="openingDate"
                        render={({ field }) => (
                            <FormItem className="flex flex-col">
                                <FormLabel>Opening Date</FormLabel>
                                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                                    <PopoverTrigger asChild>
                                        <FormControl>
                                            <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                            </Button>
                                        </FormControl>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={field.value ?? undefined}
                                            onSelect={(d) => {
                                                if (!d) return;
                                                field.onChange(d);
                                                setIsCalendarOpen(false);
                                            }}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormItem>
                        <FormLabel>Logo</FormLabel>
                        <div className="flex items-center gap-4">
                           <div className="w-16 h-16 rounded-md border flex items-center justify-center bg-muted/50 relative">
                                {logoUrl ? (
                                    <Image src={logoUrl} alt="Store logo" layout="fill" objectFit="contain" className="rounded-md" />
                                ) : (
                                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                )}
                           </div>
                            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={!store}><UploadCloud className="mr-2" />Upload</Button>
                            <input type="file" ref={fileInputRef} onChange={handleLogoUpload} className="hidden" accept="image/*" />
                        </div>
                    </FormItem>
                </div>
                <FormField control={form.control} name="isActive" render={({ field }) => ( <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm"><div className="space-y-0.5"><FormLabel>Active Status</FormLabel><FormDescription className="text-xs"> Inactive stores cannot be selected by users. </FormDescription></div><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem> )} />
              </form>
            </Form>
          </div>
        </div>
        <DialogFooter className="p-6 pt-0">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}> Cancel </Button>
          <Button type="submit" form="store-form-id" onClick={form.handleSubmit(onSubmit)} disabled={isSubmitting}> {isSubmitting ? "Saving..." : "Save Store"} </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
