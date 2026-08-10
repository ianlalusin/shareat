import { FieldValue } from "firebase-admin/firestore";

export type PlannedWrite = { path: string; data: Record<string, any>; merge?: boolean };

type OrderLineModifier = { valueName?: string };

export type OnlineOrderLine = {
  productId: string;
  variantId?: string | null;
  name: string;
  qty: number;
  modifiers?: OrderLineModifier[];
};

export type KitchenLocationRef = { kitchenLocationId: string; kitchenLocationName?: string | null };

export type BuildTicketsParams = {
  storeId: string;
  orderId: string;
  lines: OnlineOrderLine[];
  customerName: string | null;
  actorUid: string;
  locationByInvId: Map<string, KitchenLocationRef>;
  nowMs: number;
};

/** The inventory-doc id a line resolves to: the variant's own id when this
 * line is a chosen variant of a family, else the line's own product id. */
export function resolveInventoryLookupId(line: { productId: string; variantId?: string | null }): string {
  return String(line.variantId || line.productId);
}

/**
 * Builds the Firestore writes for one accepted online order's kitchen
 * tickets, as plain data — no Firestore Transaction/Firestore instance
 * involved, so this is trivially unit-testable. The caller (the accept
 * transition in route.ts) applies each write via `tx.set(db.doc(path), data,
 * merge ? { merge: true } : undefined)`.
 *
 * A line with no kitchen-location mapping is skipped (counted, not failed) —
 * the order still accepts; that item just never reaches a KDS screen.
 *
 * Ticket ids are deterministic (`${orderId}_${lineIndex}`), not Firestore
 * auto-ids: a Firestore transaction that retries on contention calls this
 * function again, and a deterministic id means the retry overwrites the same
 * ticket rather than creating a duplicate.
 */
export function buildOnlineOrderKitchenTicketWrites(params: BuildTicketsParams): {
  writes: PlannedWrite[];
  ticketsCreated: number;
  itemsSkipped: number;
} {
  const { storeId, orderId, lines, customerName, actorUid, locationByInvId, nowMs } = params;
  const writes: PlannedWrite[] = [];
  let ticketsCreated = 0;
  let itemsSkipped = 0;

  lines.forEach((line, idx) => {
    const invId = resolveInventoryLookupId(line);
    const location = locationByInvId.get(invId);
    if (!location) {
      itemsSkipped += 1;
      return;
    }

    const ticketId = `${orderId}_${idx}`;
    const modifiersText = (line.modifiers || [])
      .map((m) => m.valueName)
      .filter((v): v is string => !!v)
      .join(", ");

    const ticketData: Record<string, any> = {
      id: ticketId,
      onlineOrderId: orderId,
      storeId,
      type: "addon",
      itemId: invId,
      itemName: line.name,
      qty: line.qty,
      status: "preparing",
      kitchenLocationId: location.kitchenLocationId,
      kitchenLocationName: location.kitchenLocationName ?? null,
      customerName: customerName ?? null,
      createdByUid: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      createdAtClientMs: nowMs,
    };
    if (modifiersText) ticketData.modifiersText = modifiersText;

    writes.push({ path: `stores/${storeId}/onlineOrders/${orderId}/kitchentickets/${ticketId}`, data: ticketData });
    writes.push({
      path: `stores/${storeId}/rtKdsTickets/${location.kitchenLocationId}`,
      data: {
        [`tickets.${ticketId}`]: ticketData,
        activeIds: FieldValue.arrayUnion(ticketId),
        [`sessionIndex.${orderId}`]: FieldValue.arrayUnion(ticketId),
        "meta.updatedAt": FieldValue.serverTimestamp(),
      },
      merge: true,
    });
    ticketsCreated += 1;
  });

  return { writes, ticketsCreated, itemsSkipped };
}