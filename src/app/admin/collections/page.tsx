"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStoreContext } from "@/context/store-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader } from "lucide-react";
import { UniversalDiscountsSettings } from "@/components/admin/collections/UniversalDiscountsSettings";
import { UniversalChargesSettings } from "@/components/admin/collections/UniversalChargesSettings";
import { StoreDiscountsAdminView } from "@/components/admin/collections/StoreDiscountsAdminView";
import { StoreChargesAdminView } from "@/components/admin/collections/StoreChargesAdminView";

const TABS = [
  { value: "universal-discounts", label: "Universal Discounts" },
  { value: "universal-charges", label: "Universal Charges" },
  { value: "store-discounts", label: "Store Discounts" },
  { value: "store-charges", label: "Store Charges" },
];

export default function AdminCollectionsPage() {
  const router = useRouter();
  const { stores, loading } = useStoreContext();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState("universal-discounts");
  // Shared selection across the two "Store ..." tabs so switching tabs keeps the chosen store.
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");

  useEffect(() => {
    // Initialize once stores load, and guard against a stale id if the list changes.
    if (!stores.length) return;
    const current = stores.find(s => s.id === selectedStoreId);
    if (!current) setSelectedStoreId(stores[0].id);
  }, [stores, selectedStoreId]);

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader className="animate-spin" /></div>;
  }

  return (
    <RoleGuard allow={["admin"]}>
      <PageHeader
        title="Universal Collections"
        description="Create platform-wide discounts and charges, or oversee store-scoped entries."
      >
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </PageHeader>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {isMobile ? (
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger>
              <SelectValue placeholder="Select a tab..." />
            </SelectTrigger>
            <SelectContent>
              {TABS.map(tab => (
                <SelectItem key={tab.value} value={tab.value}>{tab.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <TabsList className="grid w-full grid-cols-4">
            {TABS.map(tab => (
              <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>
        )}

        <TabsContent value="universal-discounts">
          <UniversalDiscountsSettings stores={stores} />
        </TabsContent>
        <TabsContent value="universal-charges">
          <UniversalChargesSettings stores={stores} />
        </TabsContent>
        <TabsContent value="store-discounts">
          <StoreDiscountsAdminView
            stores={stores}
            selectedStoreId={selectedStoreId}
            onSelectedStoreChange={setSelectedStoreId}
          />
        </TabsContent>
        <TabsContent value="store-charges">
          <StoreChargesAdminView
            stores={stores}
            selectedStoreId={selectedStoreId}
            onSelectedStoreChange={setSelectedStoreId}
          />
        </TabsContent>
      </Tabs>
    </RoleGuard>
  );
}
