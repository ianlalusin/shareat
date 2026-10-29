import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { verifyWebhookSignature, parseWebhookEvent } from "@/lib/payments/paymongo/qrph";
import { applyWebhookToIntentDoc } from "@/lib/payments/paymongo/bridge.server";
import { getPaymentIntentViaApi, defaultGetJson } from "@/lib/payments/paymongo/qrph.server";
import { isSafeDocId } from "@/lib/payments/paymongo/pos-route-guards.server";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text(); // raw body required for HMAC
  const sig = req.headers.get("paymongo-signature") ?? "";
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET_POS ?? "";
  if (!secret || !verifyWebhookSignature(raw, sig, secret)) {
    // Log (without the secret value) so a future signature mismatch is diagnosable
    // instead of a silent 401 that makes PayMongo retry forever.
    console.warn(`[paymongo/webhook] signature verification failed (secret configured: ${!!secret}, sig header present: ${!!sig})`);
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const adminDb = getAdminDb();

  let ev;
  try {
    ev = parseWebhookEvent(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 }); // unparseable → ack, ignore
  }

  // Correlate by payment_intent_id via the reverse index written at create-qr time.
  // PayMongo does NOT echo the PaymentIntent's metadata onto the payment.paid
  // payment resource, so gating on ev.metadata silently ignores every real POS
  // payment. Index-doc existence IS the POS-vs-storefront filter now.
  if (!ev.paymentIntentId) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }
  if (!isSafeDocId(ev.paymentIntentId)) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }
  const indexRef = adminDb.doc(`paymongoIntentIndex/${ev.paymentIntentId}`);
  const idxSnap = await indexRef.get();
  let storeId: string;
  let intentDocId: string;
  if (idxSnap.exists) {
    ({ storeId, intentDocId } = idxSnap.data() as { storeId: string; intentDocId: string });
  } else {
    // No index yet. Either a non-POS event (storefront etc.) or a POS intent
    // whose bridge/index commit has not landed. Ask PayMongo which one: the
    // intent's own metadata (unlike the payment's) carries our POS markers.
    // A non-2xx makes PayMongo redeliver later (see the signature-failure log
    // above), so a POS event is never acknowledged before it can be applied.
    let meta: Record<string, unknown>;
    try {
      meta = (await getPaymentIntentViaApi({ getJson: defaultGetJson }, ev.paymentIntentId)).metadata;
    } catch (e) {
      console.error("[paymongo/webhook] intent lookup for unindexed event failed; asking for redelivery:", e);
      return NextResponse.json({ ok: false, retry: true }, { status: 503 });
    }
    if (meta?.kind !== "pos_session") {
      // Not a POS-originated payment — ignore.
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
    }
    const mStore = meta.storeId;
    const mIntent = meta.intentDocId;
    if (!isSafeDocId(mStore) || !isSafeDocId(mIntent)) {
      console.error("[paymongo/webhook] POS intent with malformed metadata; ignoring", ev.paymentIntentId);
      return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
    }
    const bridgeSnap = await adminDb.doc(`stores/${mStore}/paymentIntents/${mIntent}`).get();
    const bridge = bridgeSnap.exists ? (bridgeSnap.data() as PosPaymentIntentDoc) : null;
    if (!bridge || bridge.paymongoIntentId !== ev.paymentIntentId) {
      // Bridge not committed (yet). Redeliver later rather than drop the payment.
      console.warn(`[paymongo/webhook] POS intent ${ev.paymentIntentId} has no bridge yet; asking for redelivery`);
      return NextResponse.json({ ok: false, retry: true }, { status: 503 });
    }
    // Repair the missing index so later events correlate directly.
    await indexRef.set({ storeId: mStore, sessionId: bridge.sessionId, intentDocId: mIntent, createdAtMs: Date.now(), repairedByWebhook: true });
    storeId = mStore;
    intentDocId = mIntent;
  }
  if (!isSafeDocId(storeId) || !isSafeDocId(intentDocId)) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }
  const ref = adminDb.doc(`stores/${storeId}/paymentIntents/${intentDocId}`);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const { changed, next } = applyWebhookToIntentDoc(snap.data() as PosPaymentIntentDoc, ev);
    if (changed) tx.set(ref, next);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
