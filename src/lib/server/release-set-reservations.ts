import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { buildOnlineOrderKitchenTicketWrites, resolveInventoryLookupId } from "@/lib/kitchen/online-order-tickets";
import { isReleaseDue } from "@/lib/online-orders/reservation";

const SYSTEM_UID = "system:release-set-reservations";

/**
 * Sends confirmed set reservations to the kitchen screen once their release
 * time (requested time - 2h) has come: creates the kitchen tickets, moves the
 * order accepted -> preparing and stamps kitchenReleasedAtMs. Idempotent: the
 * query only sees `accepted` orders and the transaction re-checks the order,
 * so a repeated or overlapping run releases nothing twice.
 */
export async function releaseSetReservationsForStore(
  db: Firestore,
  storeId: string,
  nowMs: number,
): Promise<{ released: number; skipped: number }> {
  // Single-field query on purpose (no composite index); the rest is filtered in memory.
  const snap = await db.collection(`stores/${storeId}/onlineOrders`).where("status", "==", "accepted").get();
  let released = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    if (!isReleaseDue(doc.data() as any, nowMs)) continue;
    const orderId = doc.id;
    const orderRef = db.doc(`stores/${storeId}/onlineOrders/${orderId}`);

    const didRelease = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(orderRef);
      const order = fresh.exists ? (fresh.data() as any) : null;
      if (!order || !isReleaseDue(order, nowMs)) return false;

      const lines: any[] = Array.isArray(order.lines) ? order.lines : [];
      const locationByInvId = new Map<string, { kitchenLocationId: string; kitchenLocationName?: string | null }>();
      try {
        const invIds = Array.from(new Set(lines.map((ln) => resolveInventoryLookupId(ln)).filter(Boolean)));
        const invSnaps = invIds.length ? await tx.getAll(...invIds.map((id) => db.doc(`stores/${storeId}/inventory/${id}`))) : [];
        invSnaps.forEach((s, i) => {
          const data: any = s.exists ? s.data() : null;
          if (data?.kitchenLocationId) {
            locationByInvId.set(invIds[i], {
              kitchenLocationId: String(data.kitchenLocationId),
              kitchenLocationName: data.kitchenLocationName ?? null,
            });
          }
        });
      } catch (e) {
        console.error("[release-set-reservations] kitchen-location lookup failed; releasing with 0 tickets:", e);
      }

      const built = buildOnlineOrderKitchenTicketWrites({
        storeId,
        orderId,
        lines,
        customerName: order?.contact?.name ?? null,
        actorUid: SYSTEM_UID,
        locationByInvId,
        nowMs,
      });
      for (const w of built.writes) {
        const ref = db.doc(w.path);
        if (w.merge) tx.set(ref, w.data, { merge: true });
        else tx.set(ref, w.data);
      }
      tx.update(orderRef, {
        status: "preparing",
        kitchenReleasedAtMs: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          at: Timestamp.now(),
          atClientMs: nowMs,
          from: "accepted",
          to: "preparing",
          byUid: SYSTEM_UID,
          byName: "Auto-release",
          type: "auto_release",
        }),
      });
      return true;
    });

    if (didRelease) released += 1;
    else skipped += 1;
  }
  return { released, skipped };
}
