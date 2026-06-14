"use client";

import { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuthContext } from "@/context/auth-context";
import { useStoreContext } from "@/context/store-context";
import { useToast } from "@/hooks/use-toast";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ShoppingBag, MapPin, Phone, Mail, Truck, Store as StoreIcon } from "lucide-react";

type Modifier = { groupName?: string; valueName?: string; priceDelta?: number };
type OrderLine = {
  productId: string;
  variantId?: string;
  name: string;
  unitPrice: number;
  qty: number;
  modifiers?: Modifier[];
  modifiersTotal?: number;
  lineTotal?: number;
  note?: string;
};
type OnlineOrder = {
  id: string;
  status: string;
  createdAtClientMs?: number;
  contact?: { name?: string; phone?: string | null; email?: string | null };
  fulfillment?: { type?: "pickup" | "delivery"; address?: string; addressNotes?: string };
  lines?: OrderLine[];
  subtotal?: number;
  deliveryFee?: number;
  grandTotal?: number;
  currency?: string;
  payment?: { method?: string; paid?: boolean; ref?: string };
  receiptNumber?: string;
  statusHistory?: any[];
};

const peso = (n: number) => `₱${Number(n || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  pending: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  ready_for_pickup: "Ready for pickup",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
  rejected: "Rejected",
  expired: "Expired",
};

type TabKey = "new" | "awaiting" | "active" | "completed" | "cancelled";
const TAB_STATES: Record<TabKey, string[]> = {
  new: ["pending"],
  awaiting: ["pending_payment"],
  active: ["accepted", "preparing", "ready", "ready_for_pickup", "out_for_delivery"],
  completed: ["completed"],
  cancelled: ["cancelled", "rejected", "expired"],
};

// Available forward actions given the current status + fulfillment type.
function actionsFor(order: OnlineOrder): Array<{ to: string; label: string; needsReason?: boolean; variant?: "default" | "destructive" | "outline" }> {
  const isDelivery = order.fulfillment?.type === "delivery";
  switch (order.status) {
    case "pending":
      return [
        { to: "accepted", label: "Accept" },
        { to: "rejected", label: "Reject", needsReason: true, variant: "destructive" },
      ];
    case "accepted":
      return [
        { to: "preparing", label: "Start preparing" },
        { to: "cancelled", label: "Cancel", needsReason: true, variant: "outline" },
      ];
    case "preparing":
      return [
        { to: "ready", label: "Mark ready" },
        { to: "cancelled", label: "Cancel", needsReason: true, variant: "outline" },
      ];
    case "ready":
      return [
        isDelivery
          ? { to: "out_for_delivery", label: "Out for delivery" }
          : { to: "ready_for_pickup", label: "Ready for pickup" },
        { to: "completed", label: "Complete" },
        { to: "cancelled", label: "Cancel", needsReason: true, variant: "outline" },
      ];
    case "ready_for_pickup":
    case "out_for_delivery":
      return [
        { to: "completed", label: "Complete" },
        { to: "cancelled", label: "Cancel", needsReason: true, variant: "outline" },
      ];
    case "pending_payment":
      return [{ to: "cancelled", label: "Cancel", needsReason: true, variant: "outline" }];
    default:
      return [];
  }
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "pending") return "default";
  if (["cancelled", "rejected", "expired"].includes(status)) return "destructive";
  if (status === "completed") return "secondary";
  return "outline";
}

export default function OnlineOrdersClient() {
  const { user } = useAuthContext();
  const { activeStore } = useStoreContext();
  const { toast } = useToast();
  const storeId = activeStore?.id || "";

  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("new");
  const [selected, setSelected] = useState<OnlineOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");

  useEffect(() => {
    if (!storeId) return;
    setIsLoading(true);
    const q = query(collection(db, `stores/${storeId}/onlineOrders`), orderBy("createdAtClientMs", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setIsLoading(false);
      },
      (err) => {
        console.error(err);
        toast({ variant: "destructive", title: "Failed to load orders", description: err.message });
        setIsLoading(false);
      }
    );
    return () => unsub();
  }, [storeId, toast]);

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { new: 0, awaiting: 0, active: 0, completed: 0, cancelled: 0 };
    for (const o of orders) {
      for (const k of Object.keys(TAB_STATES) as TabKey[]) {
        if (TAB_STATES[k].includes(o.status)) c[k]++;
      }
    }
    return c;
  }, [orders]);

  const visible = useMemo(() => orders.filter((o) => TAB_STATES[tab].includes(o.status)), [orders, tab]);

  // Keep the open detail dialog in sync with live snapshots.
  useEffect(() => {
    if (!selected) return;
    const fresh = orders.find((o) => o.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [orders, selected]);

  const transition = async (order: OnlineOrder, toStatus: string, reason?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const u = user || getAuth().currentUser;
      if (!u) throw new Error("Not signed in.");
      const idToken = await u.getIdToken();
      const res = await fetch("/api/admin/online-orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ op: "transition", storeId, orderId: order.id, toStatus, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || `Update failed (${res.status})`);
      toast({ title: `Order ${STATUS_LABEL[toStatus] || toStatus}` });
      setReasonFor(null);
      setReasonText("");
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update failed", description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <RoleGuard allow={["admin", "manager", "cashier"]}>
      <div className="container mx-auto py-6 space-y-6">
        <PageHeader title="Online Orders" description={`Website storefront orders${activeStore?.name ? ` · ${activeStore.name}` : ""}.`}>
          <ShoppingBag className="h-6 w-6 text-muted-foreground" />
        </PageHeader>

        {!storeId ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">Select a store to view its online orders.</CardContent></Card>
        ) : (
          <>
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
              <TabsList>
                {(Object.keys(TAB_STATES) as TabKey[]).map((k) => (
                  <TabsTrigger key={k} value={k} className="capitalize">
                    {k === "awaiting" ? "Awaiting payment" : k}
                    {counts[k] > 0 && <Badge variant="secondary" className="ml-2">{counts[k]}</Badge>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {isLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : visible.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">No orders here.</CardContent></Card>
            ) : (
              <div className="grid gap-3">
                {visible.map((o) => (
                  <Card key={o.id} className="cursor-pointer hover:border-primary/40 transition-colors" onClick={() => setSelected(o)}>
                    <CardContent className="flex items-center justify-between gap-4 py-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold truncate">{o.contact?.name || "Guest"}</span>
                          <Badge variant={statusBadgeVariant(o.status)}>{STATUS_LABEL[o.status] || o.status}</Badge>
                          {o.fulfillment?.type === "delivery" ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Truck className="h-3 w-3" /> Delivery</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><StoreIcon className="h-3 w-3" /> Pickup</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {(o.lines?.length || 0)} item{(o.lines?.length || 0) === 1 ? "" : "s"}
                          {" · "}{o.payment?.method === "paymongo" ? (o.payment?.paid ? "Paid online" : "Online (unpaid)") : "Pay on " + (o.fulfillment?.type === "delivery" ? "delivery" : "pickup")}
                          {o.createdAtClientMs ? ` · ${new Date(o.createdAtClientMs).toLocaleString("en-PH")}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold">{peso(o.grandTotal || 0)}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) { setSelected(null); setReasonFor(null); setReasonText(""); } }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.contact?.name || "Guest"}
                  <Badge variant={statusBadgeVariant(selected.status)}>{STATUS_LABEL[selected.status] || selected.status}</Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  {selected.contact?.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> {selected.contact.phone}</div>}
                  {selected.contact?.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> {selected.contact.email}</div>}
                  <div className="flex items-center gap-2">
                    {selected.fulfillment?.type === "delivery" ? <Truck className="h-3.5 w-3.5 text-muted-foreground" /> : <StoreIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                    {selected.fulfillment?.type === "delivery" ? "Delivery" : "Pickup"}
                  </div>
                  {selected.fulfillment?.type === "delivery" && selected.fulfillment?.address && (
                    <div className="flex items-start gap-2"><MapPin className="h-3.5 w-3.5 text-muted-foreground mt-0.5" /><span>{selected.fulfillment.address}{selected.fulfillment.addressNotes ? ` — ${selected.fulfillment.addressNotes}` : ""}</span></div>
                  )}
                </div>

                <div className="rounded-md border divide-y">
                  {(selected.lines || []).map((ln, i) => (
                    <div key={i} className="flex justify-between gap-3 p-2">
                      <div className="min-w-0">
                        <div className="font-medium">{ln.qty}× {ln.name}</div>
                        {Array.isArray(ln.modifiers) && ln.modifiers.length > 0 && (
                          <div className="text-xs text-muted-foreground">{ln.modifiers.map((m) => m.valueName).filter(Boolean).join(", ")}</div>
                        )}
                        {ln.note && <div className="text-xs italic text-muted-foreground">“{ln.note}”</div>}
                      </div>
                      <div className="text-right whitespace-nowrap">{peso((ln.lineTotal ?? (ln.unitPrice + (ln.modifiersTotal || 0)) * ln.qty))}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{peso(selected.subtotal || 0)}</span></div>
                  {(selected.deliveryFee || 0) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Delivery fee</span><span>{peso(selected.deliveryFee || 0)}</span></div>}
                  <div className="flex justify-between font-semibold text-base"><span>Total</span><span>{peso(selected.grandTotal || 0)}</span></div>
                  <div className="text-xs text-muted-foreground">
                    {selected.payment?.method === "paymongo" ? (selected.payment?.paid ? "Paid online (PayMongo)" : "Online — not yet paid") : `Pay on ${selected.fulfillment?.type === "delivery" ? "delivery" : "pickup"}`}
                    {selected.receiptNumber ? ` · Receipt ${selected.receiptNumber}` : ""}
                  </div>
                </div>

                {reasonFor ? (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="text-sm font-medium">Reason for {STATUS_LABEL[reasonFor]?.toLowerCase()}</div>
                    <Textarea value={reasonText} onChange={(e) => setReasonText(e.target.value)} rows={2} placeholder="Required…" />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => { setReasonFor(null); setReasonText(""); }} disabled={busy}>Back</Button>
                      <Button variant="destructive" size="sm" disabled={busy || !reasonText.trim()} onClick={() => transition(selected, reasonFor, reasonText.trim())}>
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    {actionsFor(selected).map((a) => (
                      <Button
                        key={a.to}
                        size="sm"
                        variant={a.variant || "default"}
                        disabled={busy}
                        onClick={() => (a.needsReason ? setReasonFor(a.to) : transition(selected, a.to))}
                      >
                        {busy && !a.needsReason ? <Loader2 className="h-4 w-4 animate-spin" /> : a.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </RoleGuard>
  );
}
