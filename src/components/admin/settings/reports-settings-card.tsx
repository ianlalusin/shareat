
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { StoreSettings } from '@/lib/settings';

interface ReportsSettingsCardProps {
    settings: StoreSettings['reports'];
    onUpdate: (newValues: Partial<StoreSettings['reports']>) => void;
}

export function ReportsSettingsCard({ settings, onUpdate }: ReportsSettingsCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Reporting Settings</CardTitle>
                <CardDescription>Control data visibility and content in generated reports.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
                    <div className="flex items-center space-x-2">
                        <Switch
                            id="includeCancelledOrders"
                            checked={settings.includeCancelledOrders}
                            onCheckedChange={(c) => onUpdate({ includeCancelledOrders: c })}
                        />
                        <Label htmlFor="includeCancelledOrders">Include Cancelled Orders</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Switch
                            id="maskCustomerDetails"
                            checked={settings.maskCustomerDetails}
                            onCheckedChange={(c) => onUpdate({ maskCustomerDetails: c })}
                        />
                        <Label htmlFor="maskCustomerDetails">Mask Customer Details</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Switch
                            id="showStaffName"
                            checked={settings.showStaffName}
                            onCheckedChange={(c) => onUpdate({ showStaffName: c })}
                        />
                        <Label htmlFor="showStaffName">Show Staff Name in Reports</Label>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
