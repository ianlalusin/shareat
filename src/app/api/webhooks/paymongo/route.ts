import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { verifyWebhookSignature, parseWebhookEvent } from "@/lib/payments/paymongo/qrph";
import { applyWebhookToIntentDoc } from "@/lib/payments/paymongo/bridge.server";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text(); // raw body required for HMAC
  const sig = req.headers.get("paymongo-signature") ?? "";
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET_POS ?? "";
  if (!secret || !verifyWebhookSignature(raw, sig, secret)) {
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
  const idxSnap = await adminDb.doc(`paymongoIntentIndex/${ev.paymentIntentId}`).get();
  if (!idxSnap.exists) {
    // Not a POS-originated payment (e.g. a storefront event) — ignore.
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }
  const { storeId, intentDocId } = idxSnap.data() as { storeId: string; intentDocId: string };
  const ref = adminDb.doc(`stores/${storeId}/paymentIntents/${intentDocId}`);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const { changed, next } = applyWebhookToIntentDoc(snap.data() as PosPaymentIntentDoc, ev);
    if (changed) tx.set(ref, next);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
