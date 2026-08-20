"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { useConfirmDialog } from "@/components/global/confirm-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  scheduleCustomerCatalogAutoPublish,
  type CustomerCatalogPublishResult,
} from "@/lib/customer-catalog/auto-publish";

/**
 * The store-level switch for diner self-ordering from the CUSTOMER app.
 *
 * Lives in one component because it is surfaced in two places: Store Settings
 * (where a manager looks for store-level switches) and the Menu page (next to
 * the per-item "Customer" column it interacts with). Duplicating the write and
 * the republish would be two chances for them to drift.
 *
 * Distinct from the per-item `customerEnabled` column: that decides what a
 * diner can SEE, this decides whether they can order it themselves rather than
 * calling a server over. Opt-in — enabling the menu for a store never silently
 * opens self-ordering too.
 */
export function CustomerOrderingSettings({ variant = "card" }: { variant?: "card" | "inline" }) {
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const { confirm, Dialog } = useConfirmDialog();

  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeStore) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "stores", activeStore.id));
        if (!cancelled) setEnabled((snap.data() as any)?.customerOrderingEnabled === true);
      } catch {
        // A failed read leaves the switch off, matching the opt-in default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeStore]);

  const handleToggle = async () => {
    if (!activeStore || busy) return;
    const next = !enabled;

    const confirmed = await confirm({
      title: next
        ? `Let diners order from their phone at ${activeStore.name}?`
        : `Stop diners ordering from their phone at ${activeStore.name}?`,
      description: next
        ? "Only items marked as add-ons AND enabled for the customer app can be ordered. Orders go to the kitchen and are billed when served."
        : "The menu stays visible — diners will be asked to approach staff to order.",
      confirmText: next ? "Yes, enable" : "Yes, disable",
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await updateDoc(doc(db, "stores", activeStore.id), {
        customerOrderingEnabled: next,
        updatedAt: serverTimestamp(),
      });
      setEnabled(next);
      toast({ title: next ? "Self-ordering enabled" : "Self-ordering disabled" });
      // The switch is published inside the catalog snapshot, so the diner's app
      // only sees the change after a rebuild.
      scheduleCustomerCatalogAutoPublish(activeStore.id, (r: CustomerCatalogPublishResult) => {
        if (r.ok) {
          toast({
            title: "Customer app updated",
            description: `${r.itemCount} item${r.itemCount === 1 ? "" : "s"} live on the customer app.`,
          });
        } else {
          toast({ variant: "destructive", title: "Customer app auto-publish failed", description: r.error });
        }
      });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Update Failed", description: error.message });
    } finally {
      setBusy(false);
    }
  };

  const control = (
    <Switch
      id={`customer-self-ordering-${variant}`}
      checked={enabled}
      disabled={busy || !activeStore}
      onCheckedChange={handleToggle}
      aria-label={`Let diners order from their phone at ${activeStore?.name ?? "this store"}`}
    />
  );

  // Compact row for the Menu page toolbar, where space is tight and the
  // per-item Customer column is right below it.
  if (variant === "inline") {
    return (
      <div className="mr-auto flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
        {control}
        <Label htmlFor={`customer-self-ordering-${variant}`} className="cursor-pointer text-sm">
          <span className="font-semibold">Customer self-ordering</span>
          <span className="block text-xs text-muted-foreground">
            Diners order add-ons from their phone; billed when the kitchen serves.
          </span>
        </Label>
        {Dialog}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer Self-Ordering</CardTitle>
        <CardDescription>
          Let diners at a table order add-ons from their own phone instead of calling a server over.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border p-4">
          {control}
          <Label htmlFor={`customer-self-ordering-${variant}`} className="cursor-pointer">
            <span className="font-semibold">
              {enabled ? "Diners can order from their phone" : "Ordering is off — browse only"}
            </span>
            <span className="mt-1 block text-sm font-normal text-muted-foreground">
              {enabled
                ? "Orders go straight to the kitchen and are added to the bill when the kitchen serves them."
                : "The menu stays visible on the customer app, but diners are asked to approach staff to order."}
            </span>
          </Label>
        </div>

        <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">What a diner can actually order</p>
          <p className="mt-1">
            This switch only decides whether ordering is offered at all. An individual item is orderable
            only when it is marked as an <strong>add-on</strong> and enabled for the{" "}
            <strong>customer app</strong> on the Menu page — which also guarantees it has a price and a
            kitchen station. Everything else stays browse-only.
          </p>
          <p className="mt-2">
            Nothing is charged when a diner orders. The item reaches the bill only once the kitchen marks
            it served, so a cancelled order is never billed.
          </p>
        </div>
      </CardContent>
      {Dialog}
    </Card>
  );
}
