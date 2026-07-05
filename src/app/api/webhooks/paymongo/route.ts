import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { verifyWebhookSignature, parseWebhookEvent } from "@/lib/payments/paymongo/qrph";
import { applyWebhookToIntentDoc } from "@/lib/payments/paymongo/bridge.server";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const adminDb = getAdminDb();

  const raw = await req.text(); // raw body required for HMAC
  const sig = req.headers.get("paymongo-signature") ?? "";
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET_POS ?? "";
  if (!secret || !verifyWebhookSignature(raw, sig, secret)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  let ev;
  try {
    ev = parseWebhookEvent(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 }); // unparseable → ack, ignore
  }

  // Only handle POS session events; storefront events go to the website webhook.
  const md = ev.metadata;
  if (md?.kind !== "pos_session" || !md.storeId || !md.sessionId || !md.intentDocId) {
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const ref = adminDb.doc(
    `stores/${md.storeId}/paymentIntents/${md.intentDocId}`,
  );
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const { changed, next } = applyWebhookToIntentDoc(snap.data() as PosPaymentIntentDoc, ev);
    if (changed) tx.set(ref, next);
  });

  return NextResponse.json({ ok: true }, { status: 200 });
}
