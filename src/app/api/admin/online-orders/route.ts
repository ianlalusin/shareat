import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { applyAnalyticsDeltaServer } from "@/lib/server/analytics/applyAnalyticsDeltaServer";
import type { Receipt, ReceiptAnalyticsV2, SessionBillLine } from "@/lib/types";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

// Forward-only lifecycle + cancel/reject. Payment-driven transitions
// (pending_payment -> pending, -> expired) are owned by the PayMongo webhook in
// the website project, NOT here.
const NEXT_STATES: Record<string, string[]> = {
  pending_payment: ["cancelled"],
  pending: ["accepted", "cancelled", "rejected"],
  accepted: ["preparing", "cancelled", "rejected"],
  preparing: ["ready", "cancelled"],
  ready: ["ready_for_pickup", "out_for_delivery", "completed", "cancelled"],
  ready_for_pickup: ["completed", "cancelled"],
  out_for_delivery: ["completed", "cancelled"],
};

function paymentLabel(order: any): string {
  if (order?.payment?.method === "paymongo") return "Online (PayMongo)";
  return order?.fulfillment?.type === "delivery" ? "Cash on Delivery" : "Pay at Counter";
}

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

    if (op !== "transition") return bad(`Unknown op: ${op}`, 400);
    if (!storeId || !orderId || !toStatus) return bad("storeId, orderId, toStatus required.", 400);
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

    let didComplete = false;

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
        orderUpdate["payment.paid"] = true;
        orderUpdate["payment.settledAtMs"] = nowMs;
        didComplete = true;
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

    return NextResponse.json({ ok: true, status: toStatus, completed: didComplete, analyticsApplied });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /required|cannot move|only valid|not found/i.test(message) ? 400
      : /no access|not allowed|not a staff/i.test(message) ? 403
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
