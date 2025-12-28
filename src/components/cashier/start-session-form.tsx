
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { AppUser } from "@/context/auth-context";
import { useToast } from "@/hooks/use-toast";
import { startSession, StartSessionPayload } from "./firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, PlusCircle, Minus, Plus } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { StorePackage } from "@/components/manager/store-settings/store-packages-settings";
import { QuantityInput } from "./quantity-input";
import type { StoreFlavor } from "../manager/store-settings/store-packages-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Form, FormControl, FormField, FormItem, FormMessage } from "../ui/form";

// --- TYPES ---
export type Table = {
    id: string;
    tableNumber: string;
    status: 'available' | 'occupied';
    currentSessionId: string | null;
    isActive: boolean;
};


const unlimitedSchema = z.object({
    tableId: z.string({ required_error: "Please select a table." }),
    packageId: z.string({ required_error: "Please select a package." }),
    guestCount: z.coerce.number().min(1, "At least one guest is required."),
    initialFlavorIds: z.array(z.string()).min(1, "Select at least one flavor.").max(3, "You can select up to 3 flavors."),
    notes: z.string().optional(),
    customerName: z.string().optional(),
    customerTin: z.string().optional(),
    customerAddress: z.string().optional(),
});

const alacarteSchema = z.object({
  customerName: z.string().min(1, "Customer name is required."),
  customerTin: z.string().optional(),
  customerAddress: z.string().optional(),
});

type UnlimitedFormValues = z.infer<typeof unlimitedSchema>;
type AlaCarteFormValues = z.infer<typeof alacarteSchema>;


// --- PROPS ---
interface StartSessionFormProps {
    tables: Table[];
    packages: StorePackage[];
    flavors: StoreFlavor[];
    user: AppUser | null;
    storeId: string;
}

export function StartSessionForm({ tables, packages, flavors, user, storeId }: StartSessionFormProps) {
    const { toast } = useToast();
    const router = useRouter();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [mode, setMode] = useState<"unlimited" | "alacarte">("unlimited");

    const unlimitedForm = useForm<UnlimitedFormValues>({
        resolver: zodResolver(unlimitedSchema),
        defaultValues: {
            guestCount: 2,
            initialFlavorIds: [],
            notes: "",
            customerName: "",
            customerTin: "",
            customerAddress: "",
        },
    });
    
    const alaCarteForm = useForm<AlaCarteFormValues>({
        resolver: zodResolver(alacarteSchema),
        defaultValues: {
            customerName: "",
            customerTin: "",
            customerAddress: "",
        }
    });

    const onSubmitUnlimited = async (data: UnlimitedFormValues) => {
        if (!user || !storeId) {
            toast({ variant: 'destructive', title: 'Error', description: 'User or store not found.' });
            return;
        }
        setIsSubmitting(true);

        const chosenTable = tables.find(t => t.id === data.tableId);
        const chosenPackage = packages.find(p => p.packageId === data.packageId);

        if (!chosenPackage || !chosenTable) {
            toast({ variant: 'destructive', title: 'Error', description: 'Selected table or package not found.' });
            setIsSubmitting(false);
            return;
        }
        
        const normOpt = (v: any) => {
            const s = typeof v === "string" ? v.trim() : "";
            return s.length > 0 ? s : null;
        };
        
        const customerData = {
            name: normOpt(data.customerName),
            tin: normOpt(data.customerTin),
            address: normOpt(data.customerAddress),
        };

        const sessionPayload: StartSessionPayload = {
            tableId: chosenTable.id,
            tableNumber: chosenTable.tableNumber,
            guestCount: data.guestCount,
            initialFlavorIds: data.initialFlavorIds,
            notes: data.notes,
            package: chosenPackage,
            sessionMode: "package_dinein",
        };
        
        if (customerData.name || customerData.tin || customerData.address) {
            sessionPayload.customer = customerData;
        }

        try {
            const newSessionId = await startSession(storeId, sessionPayload, user);

            toast({ title: 'Session Created!', description: `Table ${chosenTable.tableNumber} is now pending server verification.` });
            router.push(`/cashier?sessionId=${newSessionId}`);

        } catch (error: any) {
            console.error("Error Starting Session:", error);
            toast({ variant: 'destructive', title: 'Error Starting Session', description: error.message || 'Could not start session.' });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const onSubmitAlaCarte = async (data: AlaCarteFormValues) => {
        if (!user || !storeId) {
            toast({ variant: 'destructive', title: 'Error', description: 'User or store not found.' });
            return;
        }
        
        const name = (data.customerName || "").trim();
        if (!name) {
            alaCarteForm.setError("customerName", { type: "manual", message: "Customer name is required."})
            toast({ variant: 'destructive', title: 'Validation Error', description: 'Customer name cannot be empty.'});
            return;
        }

        setIsSubmitting(true);
        
        const normOpt = (v: any) => {
            const s = typeof v === "string" ? v.trim() : "";
            return s.length > 0 ? s : null;
        };
        
        const customer = {
            name,
            tin: normOpt(data.customerTin),
            address: normOpt(data.customerAddress),
        };
        
        try {
            const newSessionId = await startSession(storeId, {
                tableId: "alacarte",
                tableNumber: "N/A",
                customer,
                sessionMode: "alacarte",
                guestCount: 1, // Default for ala carte, not displayed
            }, user);

            toast({ title: 'Order Created!', description: `Redirecting to add items.` });
            router.push(`/cashier?sessionId=${newSessionId}`);

        } catch (error: any) {
            console.error("Error Starting Session (Ala Carte):", error);
            toast({ variant: 'destructive', title: 'Error Starting Session', description: error.message || 'Could not start session.' });
        } finally {
            setIsSubmitting(false);
        }
    }
    
    const guestCount = unlimitedForm.watch("guestCount");

    return (
        <Card>
            <CardHeader>
                <CardTitle>New Session</CardTitle>
                <CardDescription>Start a new billing session for a table.</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="unlimited">Unlimited</TabsTrigger>
                        <TabsTrigger value="alacarte">Ala Carte</TabsTrigger>
                    </TabsList>
                    <TabsContent value="unlimited">
                        <Form {...unlimitedForm}>
                            <form onSubmit={unlimitedForm.handleSubmit(onSubmitUnlimited)} className="space-y-6 pt-4">
                                {/* Step 1: Table and Guests */}
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField
                                            name="tableId"
                                            control={unlimitedForm.control}
                                            render={({ field }) => (
                                                <FormItem>
                                                    <Label>Table</Label>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            {tables.map(table => <SelectItem key={table.id} value={table.id}>Table {table.tableNumber}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <div className="space-y-2">
                                            <Label>Guests</Label>
                                            <div className="flex items-center gap-2">
                                                <Button type="button" variant="outline" size="icon" onClick={() => unlimitedForm.setValue('guestCount', Math.max(1, guestCount - 1))}><Minus /></Button>
                                                <QuantityInput
                                                    value={guestCount}
                                                    onChange={(val) => unlimitedForm.setValue('guestCount', val)}
                                                    className="w-16 text-center"
                                                />
                                                <Button type="button" variant="outline" size="icon" onClick={() => unlimitedForm.setValue('guestCount', guestCount + 1)}><Plus /></Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <Separator />
                                {/* Step 2: Package */}
                                <FormField
                                    name="packageId"
                                    control={unlimitedForm.control}
                                    render={({ field }) => (
                                        <FormItem>
                                            <Label>Package</Label>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger><SelectValue placeholder="Select a package..." /></SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {packages.map(pkg => (
                                                        <SelectItem key={pkg.packageId} value={pkg.packageId}>
                                                            {pkg.packageName} - ₱{pkg.pricePerHead}/head
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <Separator />
                                {/* Step 3: Flavors */}
                                <FormField
                                    name="initialFlavorIds"
                                    control={unlimitedForm.control}
                                    render={({ field }) => (
                                        <FormItem>
                                            <Label>Initial Flavors (up to 3)</Label>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 border rounded-md max-h-40 overflow-y-auto">
                                                {flavors.map(flavor => (
                                                    <div key={flavor.flavorId} className="flex items-center gap-2">
                                                        <Checkbox
                                                            id={`flavor-${flavor.flavorId}`}
                                                            checked={field.value?.includes(flavor.flavorId)}
                                                            onCheckedChange={(checked) => {
                                                                const current = field.value || [];
                                                                const newValue = checked
                                                                    ? [...current, flavor.flavorId]
                                                                    : current.filter(id => id !== flavor.flavorId);
                                                                if (newValue.length <= 3) {
                                                                    field.onChange(newValue);
                                                                } else {
                                                                    toast({ variant: 'destructive', title: "Limit Reached", description: "You can only select up to 3 flavors."});
                                                                }
                                                            }}
                                                        />
                                                        <Label htmlFor={`flavor-${flavor.flavorId}`} className="font-normal cursor-pointer">{flavor.flavorName}</Label>
                                                    </div>
                                                ))}
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <Separator />
                                {/* Step 4: Notes and Customer */}
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="notes">Notes (Optional)</Label>
                                        <Textarea id="notes" placeholder="e.g., birthday celebration, allergies..." {...unlimitedForm.register('notes')} />
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <FormField
                                            control={unlimitedForm.control}
                                            name="customerName"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <Label>Customer Name (Optional)</Label>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={unlimitedForm.control}
                                            name="customerTin"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <Label>TIN (Optional)</Label>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <FormField
                                        control={unlimitedForm.control}
                                        name="customerAddress"
                                        render={({ field }) => (
                                            <FormItem>
                                                <Label>Address (Optional)</Label>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <Button type="submit" variant="destructive" disabled={isSubmitting} className="w-full">
                                    {isSubmitting ? <Loader2 className="animate-spin" /> : <PlusCircle className="mr-2" />}
                                    Start Session
                                </Button>
                            </form>
                        </Form>
                    </TabsContent>
                     <TabsContent value="alacarte">
                         <Form {...alaCarteForm}>
                            <form onSubmit={alaCarteForm.handleSubmit(onSubmitAlaCarte)} className="space-y-6 pt-4">
                                <div className="space-y-4">
                                    <FormField
                                        control={alaCarteForm.control}
                                        name="customerName"
                                        render={({ field }) => (
                                            <FormItem>
                                                <Label>Customer Name <span className="text-destructive">*</span></Label>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <div className="grid grid-cols-2 gap-4">
                                        <FormField
                                            control={alaCarteForm.control}
                                            name="customerTin"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <Label>TIN (Optional)</Label>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={alaCarteForm.control}
                                            name="customerAddress"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <Label>Address (Optional)</Label>
                                                    <FormControl>
                                                        <Input {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </div>
                                <Button type="submit" variant="destructive" disabled={isSubmitting} className="w-full">
                                    {isSubmitting ? <Loader2 className="animate-spin" /> : <PlusCircle className="mr-2" />}
                                    Create Order & Add Items
                                </Button>
                            </form>
                         </Form>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}
