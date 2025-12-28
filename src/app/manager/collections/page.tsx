
"use client";

import { useState } from "react";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStoreContext } from "@/context/store-context";
import { Loader } from "lucide-react";
import { ModesOfPaymentSettings } from "./_components/ModesOfPaymentSettings";
import { ChargesSettings } from "./_components/ChargesSettings";
import { DiscountsSettings } from "./_components/DiscountsSettings";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";


const TABS = [
    { value: "payments", label: "Modes of Payment" },
    { value: "charges", label: "Charges" },
    { value: "discounts", label: "Discounts" },
]

export default function CollectionsPage() {
    const { activeStore, loading } = useStoreContext();
    const isMobile = useIsMobile();
    const [activeTab, setActiveTab] = useState("payments");

    if (loading) {
        return <div className="flex items-center justify-center h-full"><Loader className="animate-spin" /></div>
    }

    if (!activeStore) {
        return (
            <Card className="w-full max-w-md mx-auto text-center">
                <CardHeader>
                    <CardTitle>No Store Selected</CardTitle>
                    <CardDescription>Please select a store from the dropdown in the header to manage its collections.</CardDescription>
                </CardHeader>
            </Card>
        )
    }
    
    return (
        <RoleGuard allow={["admin", "manager"]}>
            <PageHeader title="Store Collections" description={`Manage collections for ${activeStore.name}`} />
            <Tabs defaultValue={activeTab} value={activeTab} onValueChange={setActiveTab} className="w-full">
                {isMobile ? (
                    <Select value={activeTab} onValueChange={setActiveTab}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a setting..." />
                        </SelectTrigger>
                        <SelectContent>
                            {TABS.map(tab => (
                                <SelectItem key={tab.value} value={tab.value}>{tab.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <TabsList className="grid w-full grid-cols-3">
                        {TABS.map(tab => (
                            <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
                        ))}
                    </TabsList>
                )}

                <TabsContent value="payments">
                   <ModesOfPaymentSettings store={activeStore} />
                </TabsContent>
                <TabsContent value="charges">
                   <ChargesSettings store={activeStore} />
                </TabsContent>
                 <TabsContent value="discounts">
                     <DiscountsSettings store={activeStore} />
                 </TabsContent>
            </Tabs>
        </RoleGuard>
    )
}
