
"use client";

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useStoreContext } from '@/context/store-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from '@/components/ui/badge';
import { StorePackagesTab } from './tabs/StorePackagesTab';
import { StoreAddonsTab } from './tabs/StoreAddonsTab';
import { StoreRefillsTab } from './tabs/StoreRefillsTab';
import { StoreFlavorsTab } from './tabs/StoreFlavorsTab';
import { SchedulesSettings } from './tabs/SchedulesSettings';

export function StoreSettingsTabs() {
    const { activeStore } = useStoreContext();
    const [counts, setCounts] = useState({ packages: 0, addons: 0, refills: 0, flavors: 0, schedules: 0 });

    useEffect(() => {
        if (!activeStore) return;

        const collections = {
            packages: 'storePackages',
            addons: 'storeAddons',
            refills: 'storeRefills',
            flavors: 'storeFlavors',
            schedules: 'menuSchedules',
        };

        const unsubs = Object.entries(collections).map(([key, name]) => {
            const collRef = collection(db, "stores", activeStore.id, name);
            return onSnapshot(query(collRef), (snapshot) => {
                setCounts(prev => ({ ...prev, [key]: snapshot.size }));
            });
        });

        return () => unsubs.forEach(unsub => unsub());

    }, [activeStore]);

    if (!activeStore) return null;

    return (
        <Tabs defaultValue="packages">
            <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="packages">Packages <Badge className="ml-2">{counts.packages}</Badge></TabsTrigger>
                <TabsTrigger value="addons">Add-ons <Badge className="ml-2">{counts.addons}</Badge></TabsTrigger>
                <TabsTrigger value="refills">Refills <Badge className="ml-2">{counts.refills}</Badge></TabsTrigger>
                <TabsTrigger value="flavors">Flavors <Badge className="ml-2">{counts.flavors}</Badge></TabsTrigger>
                <TabsTrigger value="schedules">Schedules <Badge className="ml-2">{counts.schedules}</Badge></TabsTrigger>
            </TabsList>
            <TabsContent value="packages"><StorePackagesTab /></TabsContent>
            <TabsContent value="addons"><StoreAddonsTab /></TabsContent>
            <TabsContent value="refills"><StoreRefillsTab /></TabsContent>
            <TabsContent value="flavors"><StoreFlavorsTab /></TabsContent>
            <TabsContent value="schedules"><SchedulesSettings /></TabsContent>
        </Tabs>
    );
}
