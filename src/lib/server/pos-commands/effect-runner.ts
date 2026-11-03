import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { EffectRunner } from "@/lib/server/pos-commands/effects";
import { applyReceiptEvent, type ReceiptEventOp } from "@/lib/server/analytics/receiptEventApplier";
import { applyKdsTicketDeltaServer } from "@/lib/server/analytics/applyKdsTicketDeltaServer";
import { finalizePinCore, type FinalizeReason } from "@/lib/server/finalize-pin";
import {
  finalizeLoyaltyVouchers,
  writeLoyaltyEarn,
  reverseLoyaltyRedeem,
  reverseLoyaltyForReceipt,
} from "@/lib/server/loyalty";

/** 4xx outcomes from the loyalty helpers are final answers, not outages. */
function throwIfRetryable(result: { ok: boolean; error?: string; status?: number }, label: string) {
  if (result.ok) return;
  if (result.status !== undefined && result.status >= 400 && result.status < 500) return;
  throw new Error(`${label}: ${result.error || "failed"}`);
}

/**
 * Production runner for the posEffects outbox. Each branch delegates to the
 * same server function the old per-effect HTTP route used, all of which are
 * idempotent (flags / markers keyed by receipt, ticket or redemption).
 */
export const runPosEffect: EffectRunner = async ({ db, storeId, effect, payload }) => {
  const actorUid = String(payload.actorUid || "system");
  switch (effect) {
    case "analytics": {
      await applyReceiptEvent(db, storeId, String(payload.receiptId), payload.op as ReceiptEventOp, {
        revisionId: payload.revisionId ? String(payload.revisionId) : undefined,
        source: "endpoint",
      });
      return;
    }
    case "kdsAnalytics": {
      const sessionId = String(payload.sessionId);
      for (const ticketId of (payload.ticketIds as string[]) || []) {
        const ref = db.doc(`stores/${storeId}/sessions/${sessionId}/kitchentickets/${ticketId}`);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const { changed, markers } = applyKdsTicketDeltaServer(db, storeId, snap.data() as any, tx, new Date());
          if (changed) tx.update(ref, { ...markers, analyticsKdsAppliedAt: FieldValue.serverTimestamp() });
        });
      }
      return;
    }
    case "rtKdsCleanup": {
      const sessionId = String(payload.sessionId);
      const stations = (payload.stations || {}) as Record<string, Array<{ id: string; state: any }>>;
      const batch = db.batch();
      for (const [stationId, tickets] of Object.entries(stations)) {
        const rtRef = db.doc(`stores/${storeId}/rtKdsTickets/${stationId}`);
        const update: Record<string, any> = {
          activeIds: FieldValue.arrayRemove(...tickets.map((t) => t.id)),
          [`sessionIndex.${sessionId}`]: FieldValue.delete(),
          "meta.updatedAt": FieldValue.serverTimestamp(),
        };
        for (const t of tickets) update[`tickets.${t.id}`] = FieldValue.delete();
        batch.set(rtRef, {}, { merge: true });
        batch.update(rtRef, update);
        for (const t of tickets) {
          batch.set(db.doc(`stores/${storeId}/rtKdsTickets/${stationId}/closedKdsTickets/${t.id}`), t.state);
        }
      }
      await batch.commit();
      return;
    }
    case "pinFinalize": {
      await finalizePinCore({
        storeId,
        sessionId: String(payload.sessionId),
        pin: payload.pin ? String(payload.pin) : null,
        reason: payload.reason as FinalizeReason,
        actorUid,
      });
      return;
    }
    case "loyaltyFinalize": {
      const r: any = await finalizeLoyaltyVouchers({
        storeId,
        sessionId: String(payload.sessionId),
        receiptId: String(payload.receiptId),
      });
      if (r && typeof r === "object" && "ok" in r) throwIfRetryable(r, "loyalty finalize");
      return;
    }
    case "loyaltyEarn": {
      const r = await writeLoyaltyEarn({
        storeId,
        receiptId: String(payload.receiptId),
        sessionId: String(payload.sessionId),
        phone: payload.phone ? String(payload.phone) : undefined,
        staffUid: actorUid,
      } as any);
      throwIfRetryable(r, "loyalty earn");
      return;
    }
    case "loyaltyReverse": {
      for (const redemptionId of (payload.redemptionIds as string[]) || []) {
        const r = await reverseLoyaltyRedeem(redemptionId, actorUid, "void", {
          // The command already authorized the actor for this store; only
          // redemptions applied to THIS store may be reversed here.
          authorize: (appliedStoreId) => {
            if (appliedStoreId && appliedStoreId !== storeId) throw new Error("Redemption belongs to another store.");
          },
        });
        throwIfRetryable(r, "loyalty reverse");
      }
      return;
    }
    case "loyaltyReverseReceipt": {
      const r = await reverseLoyaltyForReceipt({
        storeId,
        receiptId: String(payload.receiptId),
        staffUid: actorUid,
        reason: String(payload.reason || "receipt_void"),
        refundReceiptId: payload.refundReceiptId ? String(payload.refundReceiptId) : undefined,
      });
      throwIfRetryable(r, "loyalty reverse receipt");
      return;
    }
  }
};
