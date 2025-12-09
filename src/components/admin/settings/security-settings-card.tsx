
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { StoreSettings } from '@/lib/settings';
import { Separator } from '@/components/ui/separator';

interface SecuritySettingsCardProps {
    settings: StoreSettings['security'];
    onGeneralUpdate: (newValues: Partial<StoreSettings['security']>) => void;
    onPinUpdate: (newPinValues: Partial<StoreSettings['security']['requirePin']>) => void;
}

export function SecuritySettingsCard({ settings, onGeneralUpdate, onPinUpdate }: SecuritySettingsCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Security Settings</CardTitle>
                <CardDescription>Manage PIN requirements and other security features.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="space-y-2 max-w-xs">
                    <Label htmlFor="autoLogoutMinutes">Auto-logout Timer (minutes)</Label>
                    <Input
                        id="autoLogoutMinutes"
                        type="number"
                        value={settings.autoLogoutMinutes ?? ''}
                        onChange={(e) => onGeneralUpdate({ autoLogoutMinutes: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                    <p className="text-xs text-muted-foreground">Automatically log out users after a period of inactivity. Set to 0 to disable.</p>
                </div>
                <Separator />
                <div>
                    <h3 className="text-base font-medium mb-4">Require Manager PIN for:</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
                        <div className="flex items-center space-x-2">
                            <Switch id="voidPayment" checked={settings.requirePin.voidPayment} onCheckedChange={(c) => onPinUpdate({ voidPayment: c })} />
                            <Label htmlFor="voidPayment">Voiding a Payment</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch id="cancelFinalizedBill" checked={settings.requirePin.cancelFinalizedBill} onCheckedChange={(c) => onPinUpdate({ cancelFinalizedBill: c })} />
                            <Label htmlFor="cancelFinalizedBill">Cancelling a Finalized Bill</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch id="cancelOrder" checked={settings.requirePin.cancelOrder} onCheckedChange={(c) => onPinUpdate({ cancelOrder: c })} />
                            <Label htmlFor="cancelOrder">Cancelling an Entire Order</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch id="cancelServedItem" checked={settings.requirePin.cancelServedItem} onCheckedChange={(c) => onPinUpdate({ cancelServedItem: c })} />
                            <Label htmlFor="cancelServedItem">Cancelling a Served Item</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch id="reprintReceipt" checked={settings.requirePin.reprintReceipt} onCheckedChange={(c) => onPinUpdate({ reprintReceipt: c })} />
                            <Label htmlFor="reprintReceipt">Reprinting a Receipt</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch id="backdateOrder" checked={settings.requirePin.backdateOrder} onCheckedChange={(c) => onPinUpdate({ backdateOrder: c })} />
                            <Label htmlFor="backdateOrder">Backdating an Order</Label>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="discountAbovePercent" className="text-sm">Discount above %</Label>
                            <Input
                                id="discountAbovePercent"
                                type="number"
                                value={settings.requirePin.discountAbovePercent ?? ''}
                                onChange={(e) => onPinUpdate({ discountAbovePercent: e.target.value === '' ? null : Number(e.target.value) })}
                                placeholder="e.g. 10"
                            />
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
