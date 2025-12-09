
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { StoreSettings } from '@/lib/settings';

interface KitchenSettingsCardProps {
    settings: StoreSettings['kitchen'];
    onUpdate: (newValues: Partial<StoreSettings['kitchen']>) => void;
}

export function KitchenSettingsCard({ settings, onUpdate }: KitchenSettingsCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Kitchen Display System (KDS) Settings</CardTitle>
                <CardDescription>Customize the behavior and appearance of the kitchen display.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
                    <div className="space-y-2">
                        <Label htmlFor="rushMinutes">Rush Time (minutes)</Label>
                        <Input
                            id="rushMinutes"
                            type="number"
                            value={settings.rushMinutes}
                            onChange={(e) => onUpdate({ rushMinutes: Number(e.target.value) })}
                        />
                        <p className="text-xs text-muted-foreground">An item is considered "RUSH" after this many minutes.</p>
                    </div>
                    <div className="space-y-4 pt-2">
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="highlightRush"
                                checked={settings.highlightRush}
                                onCheckedChange={(c) => onUpdate({ highlightRush: c })}
                            />
                            <Label htmlFor="highlightRush">Highlight Rush Orders</Label>
                        </div>
                         <div className="flex items-center space-x-2">
                            <Switch
                                id="showTableName"
                                checked={settings.showTableName}
                                onCheckedChange={(c) => onUpdate({ showTableName: c })}
                            />
                            <Label htmlFor="showTableName">Show Table Name</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="showPackageName"
                                checked={settings.showPackageName}
                                onCheckedChange={(c) => onUpdate({ showPackageName: c })}
                            />
                            <Label htmlFor="showPackageName">Show Package Name</Label>
                        </div>
                    </div>
                    <div className="space-y-4 pt-2">
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="playSoundOnNewItem"
                                checked={settings.playSoundOnNewItem}
                                onCheckedChange={(c) => onUpdate({ playSoundOnNewItem: c })}
                            />
                            <Label htmlFor="playSoundOnNewItem">Sound on New Item</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="playSoundForRushOnly"
                                checked={settings.playSoundForRushOnly}
                                onCheckedChange={(c) => onUpdate({ playSoundForRushOnly: c })}
                                disabled={!settings.playSoundOnNewItem}
                            />
                            <Label htmlFor="playSoundForRushOnly" className="text-muted-foreground">Sound for Rush Only</Label>
                        </div>
                         <div className="flex items-center space-x-2">
                            <Switch
                                id="showHotNotifications"
                                checked={settings.showHotNotifications}
                                onCheckedChange={(c) => onUpdate({ showHotNotifications: c })}
                            />
                            <Label htmlFor="showHotNotifications">Hot Station Notifications</Label>
                        </div>
                    </div>
                     <div className="space-y-4 pt-2">
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="showRefillHistory"
                                checked={settings.showRefillHistory}
                                onCheckedChange={(c) => onUpdate({ showRefillHistory: c })}
                            />
                            <Label htmlFor="showRefillHistory">Show Refill History</Label>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
