
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StoreSettings } from '@/lib/settings';

interface UiSettingsCardProps {
    settings: StoreSettings['ui'];
    onUpdate: (newValues: Partial<StoreSettings['ui']>) => void;
}

export function UiSettingsCard({ settings, onUpdate }: UiSettingsCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>UI & Appearance Settings</CardTitle>
                <CardDescription>Adjust the look and feel of the application.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="space-y-2">
                    <Label htmlFor="theme">Theme</Label>
                    <Select
                        value={settings.theme}
                        onValueChange={(value) => onUpdate({ theme: value as StoreSettings['ui']['theme'] })}
                    >
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="system">System</SelectItem>
                            <SelectItem value="light">Light</SelectItem>
                            <SelectItem value="dark">Dark</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="cardSize">Card Size</Label>
                    <Select
                        value={settings.cardSize}
                        onValueChange={(value) => onUpdate({ cardSize: value as StoreSettings['ui']['cardSize'] })}
                    >
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="compact">Compact</SelectItem>
                            <SelectItem value="normal">Normal</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="cardDensity">Card Density</Label>
                    <Select
                        value={settings.cardDensity}
                        onValueChange={(value) => onUpdate({ cardDensity: value as StoreSettings['ui']['cardDensity'] })}
                    >
                        <SelectTrigger><SelectValue/></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="comfortable">Comfortable</SelectItem>
                            <SelectItem value="compact">Compact</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </CardContent>
        </Card>
    );
}
