"use client";

import {
  type QueuedPayment,
  type DeferredEffect,
  pendingEffects,
  markEffect,
  isItemComplete,
} from "@/lib/offline/payment-queue";

export interface ReplayDeps {
  getToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

async function post(fetchImpl: typeof fetch, url: string, token: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Replays the pending deferred server-effects for one offline sale. Runs each
 * pending effect once; marks it "done" on HTTP success, leaves it "pending" on
 * failure for a later retry. Never re-records the sale. Returns the updated
 * item and whether all effects are now resolved.
 */
export async function replayDeferredEffects(
  item: QueuedPayment,
  deps: ReplayDeps,
): Promise<{ item: QueuedPayment; complete: boolean }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = await deps.getToken();
  const { storeId, sessionId, receiptId, ctx } = item;
  let out = item;

  for (const effect of pendingEffects(item)) {
    let okResult = false;
    if (effect === "analytics") {
      // Matches the online post-payment call in src/components/cashier/firestore.ts
      // (fetch("/api/analytics/apply-delta", ...)): the server reads storeId +
      // receiptId, recomputes the delta from the receipt doc itself, and is
      // idempotent on analyticsApplied. Body is { storeId, receiptId, op }
      // (no sessionId; field name is "op", not "kind").
      okResult = await post(fetchImpl, "/api/analytics/apply-delta", token, { storeId, receiptId, op: "payment" });
    } else if (effect === "loyaltyFinalize") {
      okResult = await post(fetchImpl, "/api/loyalty/finalize", token, { storeId, sessionId, receiptId });
    } else if (effect === "loyaltyEarn") {
      okResult = await post(fetchImpl, "/api/loyalty/earn", token, { storeId, sessionId, phone: ctx.phone, amount: ctx.amount, receiptId });
    } else if (effect === "pinFinalize") {
      okResult = await post(fetchImpl, "/api/pins/finalize", token, { storeId, sessionId, pin: ctx.pin, reason: "payment_closed" });
      if (!okResult) {
        okResult = await post(fetchImpl, "/api/pins/disable", token, { storeId, sessionId });
      }
    }
    out = markEffect(out, effect as DeferredEffect, okResult ? "done" : "pending");
  }

  return { item: out, complete: isItemComplete(out) };
}
