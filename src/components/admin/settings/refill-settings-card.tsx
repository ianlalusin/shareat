
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { StoreSettings } from '@/lib/settings';

interface RefillSettingsCardProps {
    settings: StoreSettings['refill'];
    onUpdate: (newValues: Partial<StoreSettings['refill']>) => void;
}

export function RefillSettingsCard({ settings, onUpdate }: RefillSettingsCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Refill Settings</CardTitle>
                <CardDescription>Set rules and limits for customer refills.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
                    <div className="space-y-2">
                        <Label htmlFor="maxRefillPerItem">Max Refills Per Item</Label>
                        <Input
                            id="maxRefillPerItem"
                            type="number"
                            value={settings.maxRefillPerItem ?? ''}
                            onChange={(e) => onUpdate({ maxRefillPerItem: e.target.value === '' ? null : Number(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground">Leave blank for no limit.</p>
                    </div>
                    <div className="space-y-4 pt-2">
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="allowAfterTimeLimit"
                                checked={settings.allowAfterTimeLimit}
                                onCheckedChange={(c) => onUpdate({ allowAfterTimeLimit: c })}
                            />
                            <Label htmlFor="allowAfterTimeLimit">Allow Refill After Time Limit</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="requireRushReason"
                                checked={settings.requireRushReason}
                                onCheckedChange={(c) => onUpdate({ requireRushReason: c })}
                            />
                            <Label htmlFor="requireRushReason">Require Reason for Rush Refills</Label>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
