"use client";

import { useEffect, useState } from "react";
import { getAuth } from "firebase/auth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Plus, Trash2, GripVertical, ArrowUp, ArrowDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { OptionGroup, OptionGroupValue } from "@/lib/types";

type ValueRow = OptionGroupValue;

function emptyValue(): ValueRow {
  return {
    id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    name: "",
    priceDelta: 0,
    isActive: true,
    sortOrder: 0,
  };
}

export function OptionGroupEditDialog({
  open,
  onOpenChange,
  group,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: OptionGroup | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [selectionMode, setSelectionMode] = useState<"single" | "multi">("single");
  const [required, setRequired] = useState(false);
  const [minSelections, setMinSelections] = useState<string>("");
  const [maxSelections, setMaxSelections] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [values, setValues] = useState<ValueRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (group) {
      setName(group.name);
      setSelectionMode(group.selectionMode);
      setRequired(group.required);
      setMinSelections(group.minSelections != null ? String(group.minSelections) : "");
      setMaxSelections(group.maxSelections != null ? String(group.maxSelections) : "");
      setIsActive(group.isActive !== false);
      setValues(
        (group.values || [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((v, idx) => ({ ...v, sortOrder: idx }))
      );
    } else {
      setName("");
      setSelectionMode("single");
      setRequired(false);
      setMinSelections("");
      setMaxSelections("");
      setIsActive(true);
      setValues([emptyValue(), emptyValue()]);
    }
  }, [open, group]);

  function addValue() {
    setValues((prev) => [...prev, { ...emptyValue(), sortOrder: prev.length }]);
  }

  function removeValue(idx: number) {
    setValues((prev) => prev.filter((_, i) => i !== idx).map((v, i) => ({ ...v, sortOrder: i })));
  }

  function moveValue(idx: number, dir: -1 | 1) {
    setValues((prev) => {
      const next = prev.slice();
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((v, i) => ({ ...v, sortOrder: i }));
    });
  }

  function updateValue(idx: number, patch: Partial<ValueRow>) {
    setValues((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }

  async function save() {
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast({ variant: "destructive", title: "Name required" });
      return;
    }
    const cleanValues = values.filter((v) => v.name.trim().length > 0);
    if (cleanValues.length === 0) {
      toast({ variant: "destructive", title: "At least one value required" });
      return;
    }
    const min = minSelections.trim() === "" ? undefined : Math.max(0, Number(minSelections));
    const max = maxSelections.trim() === "" ? undefined : Math.max(1, Number(maxSelections));
    if (selectionMode === "multi" && min != null && max != null && min > max) {
      toast({ variant: "destructive", title: "Min cannot exceed Max" });
      return;
    }

    setSaving(true);
    try {
      const user = getAuth().currentUser;
      if (!user) throw new Error("Not signed in.");
      const idToken = await user.getIdToken();
      const body = {
        name: trimmedName,
        selectionMode,
        required,
        minSelections: selectionMode === "multi" ? min : undefined,
        maxSelections: selectionMode === "multi" ? max : undefined,
        values: cleanValues.map((v, idx) => ({ ...v, sortOrder: idx })),
        isActive,
      };
      const path = group ? `/api/admin/option-groups/${group.id}` : "/api/admin/option-groups";
      const method = group ? "PUT" : "POST";
      const res = await fetch(path, {
        method,
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Save failed (${res.status})`);
      toast({ title: group ? "Updated" : "Created" });
      onSaved();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{group ? "Edit option group" : "New option group"}</DialogTitle>
          <DialogDescription>
            Define a reusable modifier that can be attached to one or more products.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="og-name">Name</Label>
            <Input id="og-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Cheese, Size, Spice Level" disabled={saving} />
          </div>

          <div className="grid gap-1.5">
            <Label>Selection mode</Label>
            <RadioGroup value={selectionMode} onValueChange={(v) => setSelectionMode(v as any)} className="grid gap-1">
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
                <RadioGroupItem value="single" id="mode-single" className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">Single-select (radio)</div>
                  <div className="text-xs text-muted-foreground">Customer picks exactly one value, e.g. Size = Small or Large.</div>
                </div>
              </label>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
                <RadioGroupItem value="multi" id="mode-multi" className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">Multi-select (checkbox)</div>
                  <div className="text-xs text-muted-foreground">Customer can pick zero, one, or many, e.g. Toppings.</div>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Required</div>
              <div className="text-xs text-muted-foreground">
                {selectionMode === "single"
                  ? "Customer must pick exactly one value."
                  : `Customer must pick at least ${minSelections.trim() ? minSelections : "the minimum"} values.`}
              </div>
            </div>
            <Switch checked={required} onCheckedChange={setRequired} />
          </div>

          {selectionMode === "multi" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="og-min">Min selections</Label>
                <Input id="og-min" type="number" min={0} value={minSelections} onChange={(e) => setMinSelections(e.target.value)} placeholder="0" disabled={saving} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="og-max">Max selections</Label>
                <Input id="og-max" type="number" min={1} value={maxSelections} onChange={(e) => setMaxSelections(e.target.value)} placeholder="unlimited" disabled={saving} />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="text-sm font-medium">Active</div>
              <div className="text-xs text-muted-foreground">Inactive groups won't appear in pickers.</div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Values</Label>
              <Button type="button" variant="outline" size="sm" onClick={addValue}>
                <Plus className="h-4 w-4 mr-1" /> Add value
              </Button>
            </div>
            <div className="grid gap-2">
              {values.map((v, idx) => (
                <div key={v.id} className="rounded-md border p-2 flex items-center gap-2">
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    placeholder="Name (e.g. Extra Cheese)"
                    value={v.name}
                    onChange={(e) => updateValue(idx, { name: e.target.value })}
                    className="flex-1 min-w-0"
                    disabled={saving}
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-muted-foreground">₱</span>
                    <Input
                      placeholder="0"
                      type="number"
                      value={v.priceDelta === 0 ? "" : String(v.priceDelta)}
                      onChange={(e) => updateValue(idx, { priceDelta: Number(e.target.value) || 0 })}
                      className="w-20"
                      disabled={saving}
                    />
                  </div>
                  <Switch
                    checked={v.isActive}
                    onCheckedChange={(checked) => updateValue(idx, { isActive: checked })}
                    aria-label="Active"
                  />
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveValue(idx, -1)} disabled={idx === 0 || saving}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveValue(idx, 1)} disabled={idx === values.length - 1 || saving}>
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeValue(idx)} disabled={saving}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
