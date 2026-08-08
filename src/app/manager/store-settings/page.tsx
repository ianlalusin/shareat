
"use client";

import { RoleGuard } from "@/components/guards/RoleGuard";
import { KitchenLocationsSettings } from "@/components/manager/store-settings/kitchen-locations-settings";
import { TablesSettings } from "@/components/manager/store-settings/tables-settings";
import { PageHeader } from "@/components/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStoreContext } from "@/context/store-context";
import { Loader, ArrowLeft } from "lucide-react";
import { StorePackagesSettings } from "@/components/manager/store-settings/store-packages-settings";
import { SchedulesSettings } from "@/components/manager/store-settings/schedules-settings";
import { StoreFlavorsSettings } from "@/components/manager/store-settings/store-flavors-settings";
import { StoreRefillsSettings } from "@/components/manager/store-settings/store-refills-settings";
import { ForecastSettings } from "@/components/manager/store-settings/forecast-settings";
import { LoyaltySettings } from "@/components/manager/store-settings/loyalty-settings";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";


const TABS = [
    { value: "store_packages", label: "Packages" },
    { value: "refills", label: "Refills" },
    { value: "flavors", label: "Flavors" },
    { value: "schedules", label: "Schedules" },
    { value: "kitchen", label: "Location" },
    { value: "tables", label: "Tables" },
    { value: "forecast", label: "Forecast" },
    { value: "loyalty", label: "Loyalty" },
]

export default function StoreSettingsPage() {
    const router = useRouter();
    const { activeStore, loading } = useStoreContext();
    const isMobile = useIsMobile();
    const [activeTab, setActiveTab] = useState("store_packages");

    // Track which tabs have ever been opened so we lazy-mount each panel.
    // Default-active tab is in the set on first render. Each setting panel
    // owns one or more onSnapshot subscriptions; without this, opening this
    // page would fire 8 simultaneous listeners for collections the manager
    // may never look at on this visit.
    const [mountedTabs, setMountedTabs] = useState<Set<string>>(() => new Set(["store_packages"]));
    const handleTabChange = (value: string) => {
        setActiveTab(value);
        setMountedTabs((prev) => {
            if (prev.has(value)) return prev;
            const next = new Set(prev);
            next.add(value);
            return next;
        });
    };


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
            <PageHeader title="Store Settings" description={`Manage settings for ${activeStore.name}`}>
                <Button variant="outline" onClick={() => router.back()}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                </Button>
            </PageHeader>
            <Tabs defaultValue={activeTab} value={activeTab} onValueChange={handleTabChange} className="w-full">
                {isMobile ? (
                    <Select value={activeTab} onValueChange={handleTabChange}>
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
                    <TabsList className="grid w-full grid-cols-8">
                        {TABS.map(tab => (
                             <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
                        ))}
                    </TabsList>
                )}

                <TabsContent value="store_packages">
                   {mountedTabs.has("store_packages") && <StorePackagesSettings store={activeStore} />}
                </TabsContent>
                <TabsContent value="refills">
                   {mountedTabs.has("refills") && <StoreRefillsSettings store={activeStore} />}
                </TabsContent>
                <TabsContent value="flavors">
                   {mountedTabs.has("flavors") && <StoreFlavorsSettings store={activeStore} />}
                </TabsContent>
                 <TabsContent value="schedules">
                     {mountedTabs.has("schedules") && <SchedulesSettings />}
                 </TabsContent>
                 <TabsContent value="kitchen">
                    {mountedTabs.has("kitchen") && <KitchenLocationsSettings store={activeStore} />}
                </TabsContent>
                 <TabsContent value="tables">
                    {mountedTabs.has("tables") && <TablesSettings store={activeStore} />}
                </TabsContent>
                <TabsContent value="forecast">
                    {mountedTabs.has("forecast") && <ForecastSettings store={activeStore} />}
                </TabsContent>
                <TabsContent value="loyalty">
                    {mountedTabs.has("loyalty") && <LoyaltySettings store={activeStore} />}
                </TabsContent>
            </Tabs>
        </RoleGuard>
    )
}
