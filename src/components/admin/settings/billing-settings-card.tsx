
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StoreSettings } from '@/lib/settings';

interface BillingSettingsCardProps {
    settings: StoreSettings['billing'];
    onUpdate: (newValues: Partial<StoreSettings['billing']>) => void;
}

export function BillingSettingsCard({ settings, onUpdate }: BillingSettingsCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Billing Settings</CardTitle>
                <CardDescription>Configure rules for billing, discounts, and rounding.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        <Label htmlFor="maxDiscountWithoutManager">Max Cashier Discount (%)</Label>
                        <Input 
                            id="maxDiscountWithoutManager" 
                            type="number"
                            value={settings.maxDiscountWithoutManager}
                            onChange={(e) => onUpdate({ maxDiscountWithoutManager: Number(e.target.value) })}
                        />
                         <p className="text-xs text-muted-foreground">Max discount percentage a cashier can apply without manager PIN.</p>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="roundingRule">Rounding Rule</Label>
                        <Select 
                            value={settings.roundingRule}
                            onValueChange={(value) => onUpdate({ roundingRule: value as StoreSettings['billing']['roundingRule'] })}
                        >
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No rounding</SelectItem>
                                <SelectItem value="0.25">Nearest 0.25</SelectItem>
                                <SelectItem value="0.50">Nearest 0.50</SelectItem>
                                <SelectItem value="1.00">Nearest 1.00</SelectItem>
                            </SelectContent>
                        </Select>
                         <p className="text-xs text-muted-foreground">Rule for rounding the final bill total.</p>
                    </div>
                     <div className="flex items-center space-x-2 pt-6">
                        <Switch 
                            id="showCentavos" 
                            checked={settings.showCentavos}
                            onCheckedChange={(checked) => onUpdate({ showCentavos: checked })}
                        />
                        <Label htmlFor="showCentavos">Show Centavos</Label>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
