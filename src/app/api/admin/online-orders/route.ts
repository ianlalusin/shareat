import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { applyAnalyticsDeltaServer } from "@/lib/server/analytics/applyAnalyticsDeltaServer";
import {
  isNotifiableStatus,
  notifyOrderStatusChange,
  type StatusNotifyContext,
} from "@/lib/server/notify-customer";
import type { Receipt, ReceiptAnalyticsV2, SessionBillLine } from "@/lib/types";
import { paymentLabel } from "@/lib/payment-label";
import { buildOnlineOrderKitchenTicketWrites, resolveInventoryLookupId } from "@/lib/kitchen/online-order-tickets";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

// Guards raised inside a transaction that carry their own HTTP status, so an
// operator mistake reads as a 400 instead of falling through to the message
// regex in the catch block (which only knows the transition path's wording).
class OpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Forward-only kitchen lifecycle + cancel/reject. Payment does NOT move through
// this table: pending_payment and expired are unblocked by the "confirm-payment"
// op in this same file, which sets them to "pending" once the cashier confirms
// the wallet transfer landed.
const NEXT_STATES: Record<string, string[]> = {
  pending_payment: ["cancelled"],
  pending: ["accepted", "cancelled", "rejected"],
  accepted: ["preparing", "cancelled", "rejected"],
  preparing: ["ready", "cancelled"],
  ready: ["ready_for_pickup", "out_for_delivery", "completed", "cancelled"],
  ready_for_pickup: ["completed", "cancelled"],
  out_for_delivery: ["completed", "cancelled"],
  // Reopen only. "cancelled" is deliberately absent: an expired order already
  // sits in the Cancelled tab and no caller offers that move.
  expired: ["pending"],
};

function formatReceiptNumber(fmt: string, seq: number): string {
  const m = fmt.match(/#+/g);
  if (!m) return `${fmt}${seq}`;
  const run = m.sort((a, b) => b.length - a.length)[0];
  return fmt.replace(run, String(seq).padStart(run.length, "0"));
}

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    const staff = await requireActiveStaff(db, decoded, ["admin", "manager", "cashier"]);

    const body = await req.json().catch(() => ({}));
    const op = String(body?.op || "transition");
    const storeId = body?.storeId ? String(body.storeId) : "";
    const orderId = body?.orderId ? String(body.orderId) : "";
    const toStatus = body?.toStatus ? String(body.toStatus) : "";
    const reason = body?.reason ? String(body.reason).slice(0, 300) : "";

    if (op !== "transition" && op !== "confirm-payment" && op !== "unconfirm-payment") {
      return bad(`Unknown op: ${op}`, 400);
    }
    if (op === "transition") {
      if (!storeId || !orderId || !toStatus) return bad("storeId, orderId, toStatus required.", 400);
    } else if (!storeId || !orderId) {
      return bad("storeId, orderId required.", 400);
    }
    if (!staff.isPlatformAdmin && !staff.assignedStoreIds.includes(storeId)) {
      return bad("No access to this store.", 403);
    }
    if ((toStatus === "rejected" || toStatus === "cancelled") && !reason) {
      return bad("A reason is required to cancel or reject.", 400);
    }

    const actorUid = decoded.uid;
    const actorName = (decoded as any).name || decoded.email || "Staff";
    const orderRef = db.doc(`stores/${storeId}/onlineOrders/${orderId}`);
    const settingsRef = db.doc(`stores/${storeId}/receiptSettings/main`);
    const counterRef = db.doc(`stores/${storeId}/counters/receipts`);

    // --- op: confirm-payment -------------------------------------------------
    // The cashier has seen the money in the wallet app and is recording which
    // wallet it landed in. No receipt is minted here; that still happens on
    // completion, which is also when the money reaches analytics.
    if (op === "confirm-payment") {
      const methodLabel = String(body?.methodLabel ?? "").trim().slice(0, 60);
      if (!methodLabel) return bad("A methodLabel is required to confirm payment.", 400);
      const note = body?.note ? String(body.note).slice(0, 300) : "";

      let resultStatus = "";
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists) throw new OpError("Order not found.");
        const order = snap.data() as any;
        const current = String(order?.status || "");

        if (order?.payment?.paid === true) throw new OpError("This order is already marked paid.");
        if (order?.receiptId) throw new OpError("This order already has a receipt.");
        if (current === "completed" || current === "cancelled" || current === "rejected") {
          throw new OpError(`Cannot confirm payment on a ${current} order.`);
        }

        // Deliberate bypass of NEXT_STATES: money arriving is exactly what
        // unblocks these two states, and NEXT_STATES models the forward-only
        // kitchen lifecycle, not payment. Every other status keeps its place in
        // the queue — paying early does not push an order forward.
        const revives = current === "pending_payment" || current === "expired";
        resultStatus = revives ? "pending" : current;

        const nowMs = Date.now();
        const historyEntry: any = {
          // serverTimestamp() is illegal inside array elements (statusHistory),
          // so use a concrete Timestamp.
          at: Timestamp.now(),
          atClientMs: nowMs,
          from: current,
          to: current,
          byUid: actorUid,
          byName: actorName,
          type: "payment_confirmed",
        };
        if (note) historyEntry.note = note;

        // On a revive, payment confirmation also moves the status. That is a
        // second, distinct fact from "money arrived" (the entry above), so it
        // gets its own entry rather than being folded into the one above:
        // type "transition" means "the status moved" everywhere else in this
        // file, and repurposing "payment_confirmed" to also mean that would
        // make it lie on every other order, where payment never moves status.
        // Same atClientMs as the entry above so their ordering is unambiguous.
        const historyEntries = [historyEntry];
        if (revives) {
          historyEntries.push({
            at: Timestamp.now(),
            atClientMs: nowMs,
            from: current,
            to: "pending",
            byUid: actorUid,
            byName: actorName,
            type: "transition",
            reason: "Payment confirmed",
          });
        }

        const update: any = {
          updatedAt: FieldValue.serverTimestamp(),
          statusHistory: FieldValue.arrayUnion(...historyEntries),
          "payment.paid": true,
          "payment.methodLabel": methodLabel,
          "payment.settledAtMs": nowMs,
          "payment.confirmedByUid": actorUid,
          "payment.confirmedByName": actorName,
          "payment.confirmedVia": "manual_wallet",
        };
        if (revives) update.status = "pending";

        tx.update(orderRef, update);
      });

      return NextResponse.json({ ok: true, status: resultStatus, paid: true });
    }

    // --- op: unconfirm-payment -----------------------------------------------
    // Undo of the above, for a cashier who ticked the wrong order. Status is
    // never touched: a wrongly-confirmed payment does not un-cook the food.
    if (op === "unconfirm-payment") {
      if (!reason) return bad("A reason is required to un-mark payment.", 400);

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists) throw new OpError("Order not found.");
        const order = snap.data() as any;
        const current = String(order?.status || "");

        // The receipt is what puts this money into analytics; un-ticking after
        // that point would desync the daily sales report.
        if (order?.receiptId) {
          throw new OpError("Cannot un-mark payment after the receipt is issued.");
        }
        if (order?.payment?.paid !== true) throw new OpError("This order is not marked paid.");

        tx.update(orderRef, {
          updatedAt: FieldValue.serverTimestamp(),
          statusHistory: FieldValue.arrayUnion({
            at: Timestamp.now(),
            atClientMs: Date.now(),
            from: current,
            to: current,
            byUid: actorUid,
            byName: actorName,
            type: "payment_unconfirmed",
            reason,
          }),
          "payment.paid": false,
          "payment.methodLabel": FieldValue.delete(),
          "payment.settledAtMs": FieldValue.delete(),
          "payment.confirmedByUid": FieldValue.delete(),
          "payment.confirmedByName": FieldValue.delete(),
          "payment.confirmedVia": FieldValue.delete(),
        });
      });

      return NextResponse.json({ ok: true, paid: false });
    }

    let didComplete = false;
    let ticketsCreated = 0;
    let itemsSkipped = 0;
    // Captured inside the transaction, consumed only after it commits. Left null
    // for statuses the customer is never told about, so those transitions do no
    // extra work at all.
    let notifyCtx: StatusNotifyContext | null = null;

    await db.runTransaction(async (tx) => {
      // --- reads first ---
      const snap = await tx.get(orderRef);
      if (!snap.exists) throw new Error("Order not found.");
      const order = { id: orderRef.id, ...(snap.data() as any) };
      const current = String(order.status || "");

      const allowed = NEXT_STATES[current] || [];
      if (!allowed.includes(toStatus)) {
        throw new Error(`Cannot move order from "${current}" to "${toStatus}".`);
      }
      // Fulfillment-specific guards.
      if (toStatus === "ready_for_pickup" && order?.fulfillment?.type !== "pickup") {
        throw new Error("ready_for_pickup is only valid for pickup orders.");
      }
      if (toStatus === "out_for_delivery" && order?.fulfillment?.type !== "delivery") {
        throw new Error("out_for_delivery is only valid for delivery orders.");
      }

      // --- more reads: resolve each line's kitchen location, only when accepting ---
      const accepting = toStatus === "accepted";
      const orderLines: any[] = Array.isArray(order.lines) ? order.lines : [];
      const locationByInvId = new Map<string, { kitchenLocationId: string; kitchenLocationName?: string | null }>();
      if (accepting) {
        // A lookup failure here (transient read error, or a malformed line
        // throwing during id resolution) must never block the accept itself —
        // it just means this order ends up with 0 tickets, all lines skipped.
        try {
          const invIds = Array.from(new Set(orderLines.map((ln) => resolveInventoryLookupId(ln)).filter(Boolean)));
          const invSnaps = await Promise.all(invIds.map((id) => tx.get(db.doc(`stores/${storeId}/inventory/${id}`))));
          invSnaps.forEach((snap, i) => {
            if (!snap.exists) return;
            const data: any = snap.data();
            if (data?.kitchenLocationId) {
              locationByInvId.set(invIds[i], {
                kitchenLocationId: String(data.kitchenLocationId),
                kitchenLocationName: data.kitchenLocationName ?? null,
              });
            }
          });
        } catch (e) {
          console.error("[online-orders] kitchen-location lookup failed; accepting with 0 tickets:", e);
        }
      }

      let receiptRead: any = null;
      let settingsRead: any = null;
      let counterRead: any = null;
      const completing = toStatus === "completed" && !order.receiptId;
      if (completing) {
        const [sSnap, cSnap] = await Promise.all([tx.get(settingsRef), tx.get(counterRef)]);
        settingsRead = sSnap.exists ? sSnap.data() : null;
        counterRead = cSnap.exists ? cSnap.data() : null;
      }

      // --- writes ---
      const historyEntry: any = {
        // serverTimestamp() is illegal inside array elements (statusHistory),
        // so use a concrete Timestamp.
        at: Timestamp.now(),
        atClientMs: Date.now(),
        from: current,
        to: toStatus,
        byUid: actorUid,
        byName: actorName,
        type: "transition",
      };
      if (reason) historyEntry.reason = reason;

      const orderUpdate: any = {
        status: toStatus,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion(historyEntry),
      };

      if (completing) {
        const nowMs = Date.now();
        const itemLines: SessionBillLine[] = (Array.isArray(order.lines) ? order.lines : []).map(
          (ln: any, idx: number) => ({
            id: String(ln.lineId || `ol_${idx}`),
            type: "addon",
            itemId: String(ln.variantId || ln.productId || `item_${idx}`),
            itemName: String(ln.name || "Item"),
            category: String(ln.subCategory || ln.category || "Online"),
            // Bake modifier deltas into the unit price so item-sales analytics
            // (which read only unitPrice) match what the customer paid. The
            // modifier breakdown is retained for display.
            unitPrice: Number(ln.unitPrice || 0) + Number(ln.modifiersTotal || 0),
            qtyOrdered: Number(ln.qty || 0),
            discountType: null,
            discountValue: null,
            discountQty: 0,
            freeQty: 0,
            voidedQty: 0,
            modifiers: Array.isArray(ln.modifiers) ? ln.modifiers : [],
            modifiersTotal: 0,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          })
        );

        const deliveryFee = Number(order.deliveryFee || 0);
        if (deliveryFee > 0) {
          itemLines.push({
            id: "__delivery",
            type: "addon",
            itemId: "__delivery",
            itemName: "Delivery Fee",
            category: "Delivery",
            unitPrice: deliveryFee,
            qtyOrdered: 1,
            discountType: null,
            discountValue: null,
            discountQty: 0,
            freeQty: 0,
            voidedQty: 0,
            modifiers: [],
            modifiersTotal: 0,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          } as SessionBillLine);
        }

        const grandTotal = Number(
          order.grandTotal ?? (Number(order.subtotal || 0) + deliveryFee)
        );
        const label = paymentLabel(order);

        // salesByItem / salesByCategory (no discounts/tax on online v1 → net=gross).
        const salesByItem: NonNullable<ReceiptAnalyticsV2["salesByItem"]> = {};
        const salesByCategory: NonNullable<ReceiptAnalyticsV2["salesByCategory"]> = {};
        for (const line of itemLines) {
          const qty = line.qtyOrdered;
          const amount = qty * line.unitPrice;
          const cat = line.category || "Uncategorized";
          if (!salesByItem[line.itemName]) salesByItem[line.itemName] = { qty: 0, amount: 0, categoryName: cat };
          salesByItem[line.itemName].qty += qty;
          salesByItem[line.itemName].amount += amount;
          if (!salesByCategory[cat]) salesByCategory[cat] = { qty: 0, amount: 0 };
          salesByCategory[cat].qty += qty;
          salesByCategory[cat].amount += amount;
        }

        const analyticsV2: ReceiptAnalyticsV2 = {
          v: 2,
          sessionStartedAt: null,
          sessionStartedAtClientMs: nowMs,
          sessionStartedAtHour: new Date(nowMs).getHours(),
          subtotal: grandTotal,
          discountsTotal: 0,
          chargesTotal: 0,
          taxAmount: 0,
          grandTotal,
          totalPaid: grandTotal,
          change: 0,
          mop: { [label]: grandTotal },
          salesByItem,
          salesByCategory,
        };

        const receiptNoFormat = String(settingsRead?.receiptNoFormat ?? "SELIP-######");
        const nextSeq = Number(counterRead?.seq ?? 0) + 1;
        const receiptNumber = formatReceiptNumber(receiptNoFormat, nextSeq);

        const receipt: Receipt = {
          id: orderId,
          storeId,
          sessionId: orderId,
          createdAt: FieldValue.serverTimestamp(),
          createdAtClientMs: nowMs,
          createdByUid: actorUid,
          createdByUsername: actorName,
          sessionMode: "alacarte",
          tableId: null,
          tableNumber: null,
          customerName: order?.contact?.name ?? null,
          lines: itemLines,
          total: grandTotal,
          totalPaid: grandTotal,
          change: 0,
          status: "final",
          receiptSeq: nextSeq,
          receiptNumber,
          receiptNoFormatUsed: receiptNoFormat,
          analytics: analyticsV2,
          analyticsApplied: false,
          receiptId: orderId,
        } as Receipt;
        (receipt as any).source = "online";

        tx.set(counterRef, { seq: nextSeq, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        tx.set(db.doc(`stores/${storeId}/receipts/${orderId}`), receipt);

        orderUpdate.receiptId = orderId;
        orderUpdate.receiptNumber = receiptNumber;
        // Only stamp payment here when nothing settled it earlier. settledAtMs
        // must mean "when the money arrived", not "when the food was handed
        // over" — an order confirmed paid by wallet transfer hours ago keeps
        // that earlier timestamp, and its methodLabel keeps its mop row.
        if (order?.payment?.paid !== true) {
          orderUpdate["payment.paid"] = true;
          orderUpdate["payment.settledAtMs"] = nowMs;
        }
        didComplete = true;
      }

      if (isNotifiableStatus(toStatus)) {
        notifyCtx = {
          orderId,
          status: toStatus,
          customerName: order?.contact?.name ?? null,
          email: order?.contact?.email ?? null,
          phone: order?.contact?.phone ?? null,
          // Read straight off the order. This route never computes a total.
          grandTotal: Number(order?.grandTotal ?? 0),
          fulfillmentType: order?.fulfillment?.type ?? null,
          address: order?.fulfillment?.address ?? null,
          reason: reason || null,
        };
      }

      if (accepting) {
        // Same containment as the lookup above: a bad line (or any other
        // throw while building/writing tickets) degrades to "0 tickets,
        // everything skipped" rather than failing the accept transition.
        try {
          const built = buildOnlineOrderKitchenTicketWrites({
            storeId,
            orderId,
            lines: orderLines,
            customerName: order?.contact?.name ?? null,
            actorUid,
            locationByInvId,
            nowMs: Date.now(),
          });
          ticketsCreated = built.ticketsCreated;
          itemsSkipped = built.itemsSkipped;
          for (const w of built.writes) {
            const ref = db.doc(w.path);
            if (w.merge) {
              tx.set(ref, w.data, { merge: true });
            } else {
              tx.set(ref, w.data);
            }
          }
        } catch (e) {
          console.error("[online-orders] kitchen ticket build/write failed; accepting with 0 tickets:", e);
          ticketsCreated = 0;
          itemsSkipped = orderLines.length;
        }
      }

      tx.update(orderRef, orderUpdate);
    });

    // Apply analytics in a separate, idempotent transaction (mirrors the cashier
    // flow + /api/analytics/apply-delta). A failure here never un-completes the
    // order — the receipt carries analyticsApplied:false and can be reconciled.
    let analyticsApplied = false;
    if (didComplete) {
      try {
        const receiptRef = db.doc(`stores/${storeId}/receipts/${orderId}`);
        await db.runTransaction(async (tx) => {
          const rSnap = await tx.get(receiptRef);
          if (!rSnap.exists) return;
          const receipt = { id: receiptRef.id, ...(rSnap.data() as any) } as Receipt;
          if ((receipt as any).analyticsApplied === true) return;
          applyAnalyticsDeltaServer(db, storeId, null, receipt, tx, new Date());
          tx.update(receiptRef, {
            analyticsApplied: true,
            analyticsAppliedAt: FieldValue.serverTimestamp(),
          });
        });
        analyticsApplied = true;
      } catch (e) {
        console.error("[online-orders] analytics apply failed:", e);
      }
    }

    // Customer notification. Deliberately last, and deliberately incapable of
    // affecting anything above it: the status write has committed, the receipt
    // (if any) is minted, and the analytics delta is applied. A failed send is
    // logged and recorded on the order — never surfaced as a failed transition,
    // and never allowed to change the response below.
    if (notifyCtx) {
      const ctx = notifyCtx as StatusNotifyContext;
      try {
        let storeName = "";
        try {
          const storeSnap = await db.doc(`stores/${storeId}`).get();
          storeName = String(storeSnap.data()?.name ?? "").trim();
        } catch {
          // A missing store name only costs the branch label in the message.
        }
        await notifyOrderStatusChange(orderRef, { ...ctx, storeName });
      } catch (e) {
        console.error("[online-orders] customer notification failed:", e);
      }
    }

    return NextResponse.json({ ok: true, status: toStatus, completed: didComplete, analyticsApplied, ticketsCreated, itemsSkipped });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    // Payment guards carry their own status. The regex below stays the fallback
    // for the transition path, whose Errors are plain and matched by wording.
    if (e instanceof OpError) {
      return NextResponse.json({ ok: false, error: message }, { status: e.status });
    }
    const status = /required|cannot move|only valid|not found/i.test(message) ? 400
      : /no access|not allowed|not a staff/i.test(message) ? 403
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
