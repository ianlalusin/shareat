"use client";

import { useState } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useToast } from "@/hooks/use-toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader, Save, Sparkles } from "lucide-react";

import type { Store, LoyaltyConfig } from "@/lib/types";

interface LoyaltySettingsProps {
  store: Store;
}

export function LoyaltySettings({ store }: LoyaltySettingsProps) {
  const { toast } = useToast();
  const config = store.loyaltyConfig ?? { isEnabled: true, pointsPerPeso: 0.01 };

  const [isEnabled, setIsEnabled] = useState(config.isEnabled);
  const [pointsPerPeso, setPointsPerPeso] = useState(String(config.pointsPerPeso));
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    const rate = parseFloat(pointsPerPeso);
    if (isNaN(rate) || rate < 0) {
      toast({ title: "Invalid rate", description: "Points per peso must be a non-negative number.", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const loyaltyConfig: LoyaltyConfig = { isEnabled, pointsPerPeso: rate };
      const storeRef = doc(db, "stores", store.id);
      await updateDoc(storeRef, { loyaltyConfig, updatedAt: serverTimestamp() });
      toast({ title: "Saved", description: "Loyalty settings updated." });
    } catch (err: any) {
      console.error("Save loyalty config failed:", err);
      toast({ title: "Error", description: err.message || "Failed to save.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  const exampleAmount = 1000;
  const exampleRate = parseFloat(pointsPerPeso) || 0;
  const examplePoints = Math.floor(exampleAmount * exampleRate);

  return (
    <div className="space-y-6 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Sharelebrator Loyalty
          </CardTitle>
          <CardDescription>
            Configure how customers earn points on purchases at this branch.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between border rounded-lg p-3">
            <div>
              <Label className="text-sm font-semibold">Enable loyalty earning</Label>
              <p className="text-xs text-muted-foreground">When off, linked sessions still show in the UI but no points are awarded at checkout.</p>
            </div>
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          </div>

          <div className="space-y-1">
            <Label>Points per peso</Label>
            <Input
              type="number"
              step="0.001"
              min="0"
              value={pointsPerPeso}
              onChange={(e) => setPointsPerPeso(e.target.value)}
              placeholder="0.01"
            />
            <p className="text-xs text-muted-foreground">
              0.01 = 1 point per ₱100 · 0.1 = 1 point per ₱10 · 1 = 1 point per ₱1
            </p>
          </div>

          <div className="rounded-lg bg-muted p-3 text-sm">
            <span className="text-muted-foreground">Example: </span>
            <span className="font-medium">₱{exampleAmount.toLocaleString()} purchase = </span>
            <span className="font-bold text-primary">{examplePoints} points</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Loyalty Settings
        </Button>
      </div>
    </div>
  );
}
