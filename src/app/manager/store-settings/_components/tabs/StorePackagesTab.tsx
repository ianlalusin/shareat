
"use client";

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, orderBy, getDocs, doc, Timestamp, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useStoreContext } from '@/context/store-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader, Edit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MenuSchedule } from './SchedulesSettings';
import { isScheduleActiveNow } from '../_utils/isScheduleActiveNow';

type StorePackage = {
    packageId: string;
    isEnabled: boolean;
    sortOrder: number;
    menuScheduleId?: string;
    nameSnapshot?: string;
    pricePerHeadSnapshot?: number;
};

export function StorePackagesTab() {
    const { activeStore } = useStoreContext();
    const [packages, setPackages] = useState<StorePackage[]>([]);
    const [schedules, setSchedules] = useState<Map<string, MenuSchedule>>(new Map());
    const [isLoading, setIsLoading] = useState(true);
    const [availableNowFilter, setAvailableNowFilter] = useState(false);

    useEffect(() => {
        if (!activeStore) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);

        const pkgQuery = query(collection(db, `stores/${activeStore.id}/storePackages`), where("isEnabled", "==", true), orderBy("sortOrder", "asc"));
        const unsubPackages = onSnapshot(pkgQuery, (snapshot) => {
            setPackages(snapshot.docs.map(doc => doc.data() as StorePackage));
            setIsLoading(false);
        });
        
        const schQuery = query(collection(db, `stores/${activeStore.id}/menuSchedules`), where("isActive", "==", true));
        const unsubSchedules = onSnapshot(schQuery, (snapshot) => {
             const schedulesMap = new Map<string, MenuSchedule>();
            snapshot.docs.forEach(doc => schedulesMap.set(doc.id, { id: doc.id, ...doc.data() } as MenuSchedule));
            setSchedules(schedulesMap);
        });

        return () => {
            unsubPackages();
            unsubSchedules();
        }
    }, [activeStore]);

    const filteredPackages = useMemo(() => {
        if (!availableNowFilter) {
            return packages;
        }
        return packages.filter(pkg => {
            if (!pkg.menuScheduleId) return true;
            const schedule = schedules.get(pkg.menuScheduleId);
            if (!schedule) return false;
            return isScheduleActiveNow(schedule);
        });
    }, [packages, schedules, availableNowFilter]);

    if (isLoading) {
        return <div className="flex justify-center p-8"><Loader className="animate-spin" /></div>;
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle>Store Packages</CardTitle>
                        <CardDescription>Packages enabled for this store. Prices and availability are managed here.</CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Switch id="available-now-filter" checked={availableNowFilter} onCheckedChange={setAvailableNowFilter}/>
                        <Label htmlFor="available-now-filter">Available Now</Label>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                 <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Package</TableHead>
                            <TableHead>Price/Head</TableHead>
                            <TableHead>Schedule</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredPackages.map(pkg => (
                            <TableRow key={pkg.packageId}>
                                <TableCell className="font-medium">{pkg.nameSnapshot || 'N/A'}</TableCell>
                                <TableCell>₱{(pkg.pricePerHeadSnapshot || 0).toFixed(2)}</TableCell>
                                <TableCell>
                                    <Badge variant="outline">{schedules.get(pkg.menuScheduleId || '')?.name || 'Always Available'}</Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="icon"><Edit className="h-4 w-4"/></Button>
                                </TableCell>
                            </TableRow>
                        ))}
                         {filteredPackages.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground">
                                    {availableNowFilter ? "No packages available at this time." : "No enabled packages found."}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
}
