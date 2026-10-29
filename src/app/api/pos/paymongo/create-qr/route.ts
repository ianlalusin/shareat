import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { pesosToCentavos, assertPayableAmount, type QrhpMetadata } from "@/lib/payments/paymongo/qrph";
import { createQrPaymentViaApi, defaultPostJson } from "@/lib/payments/paymongo/qrph.server";
import { buildInitialIntentDoc } from "@/lib/payments/paymongo/bridge.server";
import {
  isSafeDocId,
  checkPosPaymentAccess,
  findEnabledPaymongoMethod,
} from "@/lib/payments/paymongo/pos-route-guards.server";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  storeId: z.string().refine(isSafeDocId),
  sessionId: z.string().refine(isSafeDocId),
  amount: z.number().positive().finite(),
  methodId: z.string().refine(isSafeDocId),
  localUserId: z.string().nullish(),
});

/** A pending QR is only handed out again if it stays payable at least this long. */
const REUSE_MIN_REMAINING_MS = 60_000;
/** How long a "creating" attempt blocks a parallel request from creating another intent. */
const CREATING_LEASE_MS = 45_000;
const WAIT_FOR_PARALLEL_MS = 15_000;
const WAIT_STEP_MS = 500;

type AttemptDoc = {
  state: "creating" | "ready" | "failed";
  intentDocId: string;
  startedAtMs: number;
  sessionId: string;
  methodId: string;
  amountCentavos: number;
};

function reusable(doc: PosPaymentIntentDoc | undefined, sessionId: string, amountCentavos: number, methodId: string, nowMs: number) {
  return (
    !!doc &&
    doc.status === "awaiting_payment" &&
    doc.sessionId === sessionId &&
    doc.amountCentavos === amountCentavos &&
    doc.methodId === methodId &&
    Number(doc.expiresAtMs) - nowMs >= REUSE_MIN_REMAINING_MS
  );
}

function qrResponse(doc: PosPaymentIntentDoc, reused: boolean) {
  return NextResponse.json({
    intentDocId: doc.id,
    qrData: doc.qrData,
    imageUrl: doc.imageUrl,
    expiresAtMs: doc.expiresAtMs,
    paymongoIntentId: doc.paymongoIntentId,
    reused,
  });
}

export async function POST(req: NextRequest) {
  const adminAuth = getAdminAuth();
  const adminDb = getAdminDb();

  // 1. Authenticate the Firebase user (device).
  const authz = req.headers.get("authorization") ?? "";
  const idToken = authz.replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
  const uid = decoded.uid;

  // 2. Validate input (IDs must be single Firestore path segments).
  const parsedBody = Body.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { storeId, sessionId, amount, methodId, localUserId } = parsedBody.data;

  // 3. Authorize: active staff, cashier-capable role, assigned to this store.
  const access = await checkPosPaymentAccess(adminDb, decoded, storeId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });

  // 4. The method must be this store's active PayMongo QR Ph mode of payment.
  const method = await findEnabledPaymongoMethod(adminDb, storeId, methodId);
  if (!method) return NextResponse.json({ error: "Payment method is not an enabled PayMongo method for this store" }, { status: 400 });

  // 5. The session must exist, be active, and belong to storeId.
  const sessionRef = adminDb.doc(`stores/${storeId}/sessions/${sessionId}`);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists || sessionSnap.get("status") !== "active") {
    return NextResponse.json({ error: "Session not open" }, { status: 409 });
  }

  // 6. Validate amount against PayMongo minimum.
  const amountCentavos = pesosToCentavos(amount);
  try {
    assertPayableAmount(amountCentavos);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  // 7. Idempotency: one durable attempt per store/session/method/amount. A retry
  // (lost response, re-mount, double tap) gets the SAME pending QR back instead
  // of a second payable PayMongo intent. The attempt is claimed in a
  // transaction BEFORE any provider call, so two parallel requests cannot both
  // create an intent.
  const intentsCol = adminDb.collection(`stores/${storeId}/paymentIntents`);
  const attemptRef = adminDb.doc(`stores/${storeId}/paymentIntentAttempts/${sessionId}__${methodId}__${amountCentavos}`);
  type Claim = { kind: "reuse"; doc: PosPaymentIntentDoc } | { kind: "wait"; intentDocId: string } | { kind: "create"; intentDocId: string };
  const claim: Claim = await adminDb.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const aSnap = await tx.get(attemptRef);
    const attempt = aSnap.exists ? (aSnap.data() as AttemptDoc) : null;
    if (attempt?.intentDocId && isSafeDocId(attempt.intentDocId)) {
      const bSnap = await tx.get(intentsCol.doc(attempt.intentDocId));
      const bridge = bSnap.exists ? (bSnap.data() as PosPaymentIntentDoc) : undefined;
      if (reusable(bridge, sessionId, amountCentavos, methodId, nowMs)) return { kind: "reuse", doc: bridge! };
      if (!bridge && attempt.state === "creating" && nowMs - Number(attempt.startedAtMs) < CREATING_LEASE_MS) {
        return { kind: "wait", intentDocId: attempt.intentDocId };
      }
    }
    const intentDocId = intentsCol.doc().id;
    const next: AttemptDoc = { state: "creating", intentDocId, startedAtMs: nowMs, sessionId, methodId, amountCentavos };
    tx.set(attemptRef, { ...next, createdByUid: uid });
    return { kind: "create", intentDocId };
  });

  if (claim.kind === "reuse") return qrResponse(claim.doc, true);
  if (claim.kind === "wait") {
    // A parallel request is mid-creation for this exact tender: wait for its bridge.
    const deadline = Date.now() + WAIT_FOR_PARALLEL_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
      const snap = await intentsCol.doc(claim.intentDocId).get();
      if (snap.exists) {
        const doc = snap.data() as PosPaymentIntentDoc;
        if (reusable(doc, sessionId, amountCentavos, methodId, Date.now())) return qrResponse(doc, true);
        break;
      }
    }
    return NextResponse.json({ error: "Payment is already being started for this amount. Try again in a moment." }, { status: 409 });
  }

  const intentRef = intentsCol.doc(claim.intentDocId);
  const metadata: QrhpMetadata = { storeId, sessionId, intentDocId: intentRef.id, kind: "pos_session" };

  // 8. Create the QR at PayMongo.
  let parsed;
  try {
    parsed = await createQrPaymentViaApi(
      { postJson: defaultPostJson },
      // PayMongo requires billing.email on the qrph payment method. We don't collect a
      // customer email at the till, so use a merchant address (receipts, if any, go here).
      { amountCentavos, description: `${storeId} session ${sessionId}`, metadata, billing: { name: `Shareat ${storeId}`, email: "pos@shareat.net" } },
    );
  } catch (e) {
    console.error("[paymongo/create-qr] PayMongo QR creation failed:", e);
    // Release the claim so the cashier can retry straight away. Best-effort: a
    // stale "creating" claim also expires after CREATING_LEASE_MS.
    await attemptRef.set({ state: "failed", failedAtMs: Date.now() }, { merge: true }).catch(() => {});
    // `reason` carries PayMongo's cleaned, human-readable detail (or a config/guard
    // message) so the cashier sees WHY (e.g. method not enabled, amount too low).
    return NextResponse.json({ error: "Could not start payment", reason: (e as Error).message }, { status: 502 });
  }

  // 9. Persist the bridge doc AND a server-only reverse-index doc (PayMongo
  // intent id -> bridge-doc address) atomically, so the webhook can correlate
  // payment.paid events by payment_intent_id without relying on metadata
  // being echoed onto the payment resource (it isn't). The QR is only returned
  // to the till after this commits.
  const doc = buildInitialIntentDoc({
    intentDocId: intentRef.id, storeId, sessionId, amount, amountCentavos, methodId,
    createdByUid: uid, createdByLocalUserId: localUserId ?? null, parsed, nowMs: Date.now(),
  });
  const indexRef = adminDb.doc(`paymongoIntentIndex/${parsed.paymongoIntentId}`);
  const batch = adminDb.batch();
  batch.set(intentRef, doc);
  batch.set(indexRef, { storeId, sessionId, intentDocId: intentRef.id, createdAtMs: Date.now() });
  batch.set(attemptRef, { state: "ready", readyAtMs: Date.now(), paymongoIntentId: parsed.paymongoIntentId }, { merge: true });
  await batch.commit();

  return qrResponse(doc, false);
}
