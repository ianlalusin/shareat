"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Product } from "@/lib/types";
import { getDisplayName } from "@/lib/products/variants";

type Mode = "create" | "promote";

function extractParenthetical(name: string): { base: string; paren: string } {
  const match = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (match) {
    return { base: match[1].trim(), paren: match[2].trim() };
  }
  return { base: name.trim(), paren: "" };
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return "";
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (strings[i].toLowerCase().indexOf(prefix.toLowerCase()) !== 0) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  return prefix.replace(/[\s\-_(]+$/, "").trim();
}

export function ProductMergeDialog({
  open,
  onOpenChange,
  selected,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: Product[];
  onMerged: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("create");
  const [parentName, setParentName] = useState("");
  const [parentProductId, setParentProductId] = useState<string | null>(null);
  const [variantLabels, setVariantLabels] = useState<Record<string, string>>({});
  const [understood, setUnderstood] = useState(false);
  const [inventoryCounts, setInventoryCounts] = useState<Record<string, number> | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Initialize defaults when the dialog opens.
  useEffect(() => {
    if (!open || selected.length === 0) return;

    const parts = selected.map((p) => extractParenthetical(p.name || ""));
    const defaultParentName =
      parts.every((x) => x.base === parts[0].base) && parts[0].base
        ? parts[0].base
        : longestCommonPrefix(selected.map((p) => p.name || "")) || (selected[0]?.name ?? "");

    const labels: Record<string, string> = {};
    selected.forEach((p, i) => {
      const parsed = parts[i];
      labels[p.id] = parsed.paren || p.variantLabel || p.variant || "";
    });

    setMode("create");
    setParentName(defaultParentName);
    setParentProductId(selected[0]?.id ?? null);
    setVariantLabels(labels);
    setUnderstood(false);
    setInventoryCounts(null);

    // Fire-and-forget pre-flight inventory count.
    void fetchInventoryCounts(selected.map((p) => p.id));
  }, [open, selected]);

  const fetchInventoryCounts = useCallback(async (ids: string[]) => {
    try {
      setLoadingCounts(true);
      const u = getAuth().currentUser;
      if (!u) return;
      const idToken = await u.getIdToken();
      const res = await fetch("/api/admin/products/inventory-counts", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: ids }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok) setInventoryCounts(json.counts || {});
      else setInventoryCounts({});
    } catch {
      setInventoryCounts({});
    } finally {
      setLoadingCounts(false);
    }
  }, []);

  const allLabelsFilled = useMemo(
    () => selected.every((p) => (variantLabels[p.id] || "").trim().length > 0),
    [selected, variantLabels]
  );

  const promotedHasInventory =
    mode === "promote" &&
    parentProductId != null &&
    inventoryCounts != null &&
    (inventoryCounts[parentProductId] || 0) > 0;

  const canSubmit =
    !submitting &&
    parentName.trim().length > 0 &&
    selected.length >= 2 &&
    allLabelsFilled &&
    (mode === "create" || (parentProductId != null && (!promotedHasInventory || understood)));

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const u = getAuth().currentUser;
      if (!u) throw new Error("Not signed in.");
      const idToken = await u.getIdToken();
      const res = await fetch("/api/admin/products/merge", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          parentName: parentName.trim(),
          parentProductId: mode === "promote" ? parentProductId : null,
          variants: selected.map((p) => ({
            productId: p.id,
            variantLabel: (variantLabels[p.id] || "").trim(),
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Merge failed (${res.status}).`);
      toast({
        title: "Family created",
        description: `${parentName.trim()} with ${json.variantCount} variants.`,
      });
      onMerged();
      onOpenChange(false);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Merge failed", description: e?.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Merge into family</DialogTitle>
          <DialogDescription>
            Turn {selected.length} selected products into one family. The family parent groups them together for display
            and management. Each variant remains its own sellable SKU with its own barcode and inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div>
            <Label className="text-sm">Mode</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="mt-1 grid gap-2">
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
                <RadioGroupItem value="create" id="mode-create" className="mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Create a new family parent</div>
                  <div className="text-xs text-muted-foreground">
                    Recommended. Creates a brand-new umbrella product. None of your selected products change kind in a
                    way that affects the cashier.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
                <RadioGroupItem value="promote" id="mode-promote" className="mt-0.5" />
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Promote one of these into the parent</div>
                  <div className="text-xs text-muted-foreground">
                    Use this when one of the selected rows is already the natural "umbrella". That row will stop being
                    a sellable SKU.
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div>
            <Label htmlFor="parent-name" className="text-sm">
              Family name
            </Label>
            <Input
              id="parent-name"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
              placeholder="e.g., Kimpab"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Shown as "{parentName.trim() || "Family"} (Variant)" on lists and receipts.
            </p>
          </div>

          {mode === "promote" && (
            <div>
              <Label className="text-sm">Promote which row?</Label>
              <RadioGroup
                value={parentProductId ?? ""}
                onValueChange={(v) => setParentProductId(v)}
                className="mt-1 grid gap-1"
              >
                {selected.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/40"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value={p.id} id={`promote-${p.id}`} />
                      <span className="text-sm">{getDisplayName(p)}</span>
                    </div>
                    {inventoryCounts != null && (inventoryCounts[p.id] || 0) > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {inventoryCounts[p.id]} store{inventoryCounts[p.id] === 1 ? "" : "s"} stocking
                      </Badge>
                    )}
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          {promotedHasInventory && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                <div className="font-semibold mb-1">Promoted parent has active store inventory.</div>
                <p className="mb-2">
                  The promoted product will become a non-sellable family umbrella. Existing inventory rows for it will
                  keep working in the cashier (no break), but you may want to deactivate those rows from the inventory
                  page since the family parent isn't meant to be sold directly.
                </p>
                <label className="flex items-center gap-2">
                  <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(v === true)} />
                  <span>I understand and want to proceed.</span>
                </label>
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label className="text-sm">Variant labels</Label>
            <p className="text-xs text-muted-foreground mb-2">
              The bit that goes inside the parentheses for each row, e.g. "Signature".
            </p>
            <div className="grid gap-2">
              {selected.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.barcode ? `Barcode: ${p.barcode}` : "No barcode"}
                      {inventoryCounts != null && (inventoryCounts[p.id] || 0) > 0 && (
                        <>
                          {" · "}
                          {inventoryCounts[p.id]} store{inventoryCounts[p.id] === 1 ? "" : "s"} stocking
                        </>
                      )}
                    </div>
                  </div>
                  <Input
                    value={variantLabels[p.id] ?? ""}
                    onChange={(e) => setVariantLabels({ ...variantLabels, [p.id]: e.target.value })}
                    placeholder="Signature"
                    className="w-40"
                    disabled={submitting}
                  />
                </div>
              ))}
            </div>
          </div>

          {loadingCounts && (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking inventory references…
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
