import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { pesosToCentavos, assertPayableAmount, type QrhpMetadata } from "@/lib/payments/paymongo/qrph";
import { createQrPaymentViaApi, defaultPostJson } from "@/lib/payments/paymongo/qrph.server";
import { buildInitialIntentDoc } from "@/lib/payments/paymongo/bridge.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  storeId: z.string().min(1),
  sessionId: z.string().min(1),
  amount: z.number().positive(),
  methodId: z.string().min(1),
  localUserId: z.string().nullish(),
});

export async function POST(req: NextRequest) {
  const adminAuth = getAdminAuth();
  const adminDb = getAdminDb();

  // 1. Authenticate the Firebase user (device).
  const authz = req.headers.get("authorization") ?? "";
  const idToken = authz.replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(idToken, true)).uid;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // 2. Validate input.
  const parsedBody = Body.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { storeId, sessionId, amount, methodId, localUserId } = parsedBody.data;

  // 3. Authorize against the live session (must exist, be active, and belong to storeId).
  const sessionRef = adminDb.doc(`stores/${storeId}/sessions/${sessionId}`);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists || sessionSnap.get("status") !== "active") {
    return NextResponse.json({ error: "Session not open" }, { status: 409 });
  }

  // 4. Validate amount against PayMongo minimum.
  const amountCentavos = pesosToCentavos(amount);
  try {
    assertPayableAmount(amountCentavos);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // 5. Pre-allocate the bridge doc id (so metadata can reference it).
  const intentsCol = adminDb.collection(`stores/${storeId}/paymentIntents`);
  const intentRef = intentsCol.doc();
  const metadata: QrhpMetadata = { storeId, sessionId, intentDocId: intentRef.id, kind: "pos_session" };

  // 6. Create the QR at PayMongo.
  let parsed;
  try {
    parsed = await createQrPaymentViaApi(
      { postJson: defaultPostJson },
      { amountCentavos, description: `${storeId} session ${sessionId}`, metadata, billing: { name: `Shareat ${storeId}` } },
    );
  } catch (e) {
    console.error("[paymongo/create-qr] PayMongo QR creation failed:", e);
    // `reason` carries PayMongo's cleaned, human-readable detail (or a config/guard
    // message) so the cashier sees WHY (e.g. method not enabled, amount too low).
    return NextResponse.json({ error: "Could not start payment", reason: (e as Error).message }, { status: 502 });
  }

  // 7. Persist the bridge doc AND a server-only reverse-index doc (PayMongo
  // intent id -> bridge-doc address) atomically, so the webhook can correlate
  // payment.paid events by payment_intent_id without relying on metadata
  // being echoed onto the payment resource (it isn't).
  const doc = buildInitialIntentDoc({
    intentDocId: intentRef.id, storeId, sessionId, amount, amountCentavos, methodId,
    createdByUid: uid, createdByLocalUserId: localUserId ?? null, parsed, nowMs: Date.now(),
  });
  const indexRef = adminDb.doc(`paymongoIntentIndex/${parsed.paymongoIntentId}`);
  const batch = adminDb.batch();
  batch.set(intentRef, doc);
  batch.set(indexRef, { storeId, sessionId, intentDocId: intentRef.id, createdAtMs: Date.now() });
  await batch.commit();

  return NextResponse.json({
    intentDocId: intentRef.id,
    qrData: doc.qrData,
    imageUrl: doc.imageUrl,
    expiresAtMs: doc.expiresAtMs,
    paymongoIntentId: doc.paymongoIntentId,
  });
}
