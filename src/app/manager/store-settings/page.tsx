
"use client";

import { RoleGuard } from "@/components/guards/RoleGuard";
import { AddonsSettings } from "@/components/manager/store-settings/addons-settings";
import { KitchenLocationsSettings } from "@/components/manager/store-settings/kitchen-locations-settings";
import { TablesSettings } from "@/components/manager/store-settings/tables-settings";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStoreContext } from "@/context/store-context";
import { Loader } from "lucide-react";
import { StorePackagesSettings } from "@/components/manager/store-settings/store-packages-settings";
import { SchedulesSettings } from "@/components/manager/store-settings/schedules-settings";
import { StoreFlavorsSettings } from "@/components/manager/store-settings/store-flavors-settings";
import { StoreRefillsSettings } from "@/components/manager/store-settings/store-refills-settings";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";


const TABS = [
    { value: "store_packages", label: "Packages" },
    { value: "addons", label: "Add-ons" },
    { value: "refills", label: "Refills" },
    { value: "flavors", label: "Flavors" },
    { value: "schedules", label: "Schedules" },
    { value: "kitchen", label: "Kitchen" },
    { value: "tables", label: "Tables" },
]

export default function StoreSettingsPage() {
    const { activeStore, loading } = useStoreContext();
    const isMobile = useIsMobile();
    const [activeTab, setActiveTab] = useState("store_packages");


    if (loading) {
        return <div className="flex items-center justify-center h-full"><Loader className="animate-spin" /></div>
    }

    if (!activeStore) {
        return (
            <Card className="w-full max-w-md mx-auto text-center">
                <CardHeader>
                    <CardTitle>No Store Selected</CardTitle>
                    <CardDescription>Please select a store from the dropdown in the header to manage its settings.</CardDescription>
                </CardHeader>
            </Card>
        )
    }
    
    return (
        <RoleGuard allow={["admin", "manager"]}>
            <PageHeader title="Store Settings" description={`Manage settings for ${activeStore.name}`} />
            <Tabs defaultValue={activeTab} value={activeTab} onValueChange={setActiveTab} className="w-full">
                {isMobile ? (
                    <Select value={activeTab} onValueChange={setActiveTab}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a setting to manage..." />
                        </SelectTrigger>
                        <SelectContent>
                            {TABS.map(tab => (
                                <SelectItem key={tab.value} value={tab.value}>{tab.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                ) : (
                    <TabsList className="grid w-full grid-cols-7">
                        {TABS.map(tab => (
                             <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
                        ))}
                    </TabsList>
                )}

                <TabsContent value="store_packages">
                   <StorePackagesSettings store={activeStore} />
                </TabsContent>
                <TabsContent value="addons">
                   <AddonsSettings store={activeStore} />
                </TabsContent>
                <TabsContent value="refills">
                   <StoreRefillsSettings store={activeStore} />
                </TabsContent>
                <TabsContent value="flavors">
                   <StoreFlavorsSettings store={activeStore} />
                </TabsContent>
                 <TabsContent value="schedules">
                     <SchedulesSettings />
                 </TabsContent>
                 <TabsContent value="kitchen">
                    <KitchenLocationsSettings store={activeStore} />
                </TabsContent>
                 <TabsContent value="tables">
                    <TablesSettings store={activeStore} />
                </TabsContent>
            </Tabs>
        </RoleGuard>
    )
}
