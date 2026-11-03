import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import { createHash, randomUUID } from "node:crypto";
import { pesosToCentavos, assertPayableAmount, type ParsedQr, type QrhpMetadata } from "@/lib/payments/paymongo/qrph";
import {
  createOrResumeQrViaApi,
  defaultGetJson,
  defaultPostJson,
  getPaymentIntentViaApi,
  IntentCorrelationError,
  isDefinitiveProviderRejection,
  type QrCreateResult,
} from "@/lib/payments/paymongo/qrph.server";
import { buildInitialIntentDoc, TEN_MINUTES_MS } from "@/lib/payments/paymongo/bridge.server";
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
  // Newer clients (audit B24/P4). Both optional so installed APKs keep working.
  /** Client tender request id: stable per tender on the till, recorded as the operation id. */
  tenderRequestId: z.string().max(128).refine(isSafeDocId).nullish(),
  /** The session billingRevision the till priced this tender against. */
  billingRevision: z.number().int().nonnegative().nullish(),
});

/** A pending QR is only handed out again if it stays payable at least this long. */
const REUSE_MIN_REMAINING_MS = 60_000;
/** How long a "creating" attempt blocks a parallel request from creating another intent. */
const CREATING_LEASE_MS = 45_000;
const WAIT_FOR_PARALLEL_MS = 15_000;
const WAIT_STEP_MS = 500;

/**
 * PayMongo keeps idempotency keys for 24 hours
 * (https://docs.paymongo.com/reference/idempotent-requests). An unresolved
 * generation older than this, with no saved intent id, cannot be resumed by
 * key replay, so it starts over. Any intent it might have created was never
 * shown as a QR (the QR is only returned after the bridge commits), so it
 * cannot have been paid.
 */
const IDEMPOTENCY_KEY_SAFE_MS = 23 * 60 * 60 * 1000;

/**
 * stores/{storeId}/paymentIntentAttempts/{sessionId}__{methodId}__{amountCentavos}
 * Fields from before B24/P4 keep their names; the rest are additive.
 */
type AttemptDoc = {
  state: "creating" | "ready" | "failed";
  intentDocId: string;
  startedAtMs: number;
  sessionId: string;
  methodId: string;
  amountCentavos: number;
  // --- B24/P4 recovery (absent on older docs) ---
  /** Bumped whenever a new bridge id + idempotency key is minted. */
  generation?: number;
  generationStartedAtMs?: number;
  /** Provider Idempotency-Key used for POST /v1/payment_intents of this generation (audit trail; recomputed, not trusted). */
  idempotencyKey?: string;
  /** Saved as soon as PayMongo returns it, before method/attach. */
  paymongoIntentId?: string | null;
  /** Payment-method attach counter; part of the method idempotency key. */
  attachNo?: number;
  leaseId?: string;
  leaseAtMs?: number;
  failureKind?: "ambiguous" | "definitive";
  operationId?: string | null;
  billingRevision?: number;
  /** Revision sent in this generation's provider metadata (identical across resumes). */
  generationBillingRevision?: number;
  /** Random per generation; part of the idempotency key. */
  nonce?: string;
};

/**
 * A bridge saved without a QR because PayMongo already reported the intent as
 * paid/processing. It is still awaiting settlement, so a new tap must re-check
 * that intent, never mint a second payable QR for the same tender.
 */
function awaitingWithoutQr(doc: PosPaymentIntentDoc | undefined, sessionId: string, amountCentavos: number, methodId: string) {
  return (
    !!doc &&
    doc.status === "awaiting_payment" &&
    !doc.qrData && !doc.imageUrl &&
    doc.sessionId === sessionId &&
    doc.amountCentavos === amountCentavos &&
    doc.methodId === methodId
  );
}

function inProgressResponse(intentDocId: string, paymongoIntentId: string) {
  return NextResponse.json({
    error: "This QR payment is already being completed at PayMongo. Check its status before taking another payment.",
    intentDocId,
    paymongoIntentId,
  }, { status: 409 });
}

/**
 * Deterministic per attempt generation; ≤255 chars as PayMongo requires. The
 * random per-generation nonce keeps keys unique even if the attempt doc is
 * deleted and its generation counter restarts within PayMongo's 24 h window.
 */
function idempotencyKeyFor(storeId: string, attemptId: string, generation: number, nonce: string) {
  const h = createHash("sha256").update(`${storeId}\n${attemptId}\n${generation}\n${nonce}`).digest("hex").slice(0, 48);
  return `shareat-pos-qr-${h}`;
}

/** Can this unfinished attempt be resumed in place (same key / saved intent)? */
function resumable(a: AttemptDoc, nowMs: number) {
  if (!a.idempotencyKey || !Number.isInteger(a.generation) || Number(a.generation) < 1) return false; // pre-B24 doc
  if (typeof a.nonce !== "string" || !a.nonce) return false;
  if (a.state === "ready") return false;
  if (a.state === "failed" && a.failureKind !== "ambiguous") return false;
  if (a.paymongoIntentId) return true;
  return nowMs - Number(a.generationStartedAtMs ?? a.startedAtMs) < IDEMPOTENCY_KEY_SAFE_MS;
}

function reusable(doc: PosPaymentIntentDoc | undefined, sessionId: string, amountCentavos: number, methodId: string, nowMs: number) {
  return (
    !!doc &&
    doc.status === "awaiting_payment" &&
    !!(doc.qrData || doc.imageUrl) &&
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
  const { storeId, sessionId, amount, methodId, localUserId, tenderRequestId, billingRevision: clientBillingRevision } = parsedBody.data;

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

  // 7. The bill revision this tender is priced against. The server reads it;
  // a client that sends one (newer APKs) must match or the bill moved on.
  const billingRevision = Number(sessionSnap.get("billingRevision") ?? 0);
  if (clientBillingRevision != null && clientBillingRevision !== billingRevision) {
    return NextResponse.json({ error: "The bill changed. Review the total and try again.", billingRevision }, { status: 409 });
  }

  // 8. Idempotency: one durable attempt per store/session/method/amount. A retry
  // (lost response, re-mount, double tap, a new tenderRequestId for the same
  // tender) gets the SAME pending QR back instead of a second payable PayMongo
  // intent. The attempt is claimed in a transaction BEFORE any provider call,
  // so two parallel requests cannot both create an intent, and it carries the
  // provider idempotency key so an ambiguous create is resumable (B24).
  const intentsCol = adminDb.collection(`stores/${storeId}/paymentIntents`);
  const attemptId = `${sessionId}__${methodId}__${amountCentavos}`;
  const attemptRef = adminDb.doc(`stores/${storeId}/paymentIntentAttempts/${attemptId}`);
  const leaseId = randomUUID();
  const operationId = tenderRequestId ?? null;

  type Work = { intentDocId: string; generation: number; paymongoIntentId: string | null; attachNo: number; operationId: string | null; metaBillingRevision: number; nonce: string };
  type Claim =
    | { kind: "reuse"; doc: PosPaymentIntentDoc }
    | { kind: "wait"; intentDocId: string }
    | { kind: "recheck"; doc: PosPaymentIntentDoc }
    | { kind: "work"; work: Work };

  /** A brand-new generation: new bridge id, new idempotency key, no provider id. */
  const newGeneration = (tx: any, attempt: AttemptDoc | null, nowMs: number): Claim => {
    const generation = Number(attempt?.generation ?? 0) + 1;
    const nonce = randomUUID();
    const intentDocId = intentsCol.doc().id;
    const next: AttemptDoc = {
      state: "creating", intentDocId, startedAtMs: nowMs, sessionId, methodId, amountCentavos,
      generation, generationStartedAtMs: nowMs, nonce, idempotencyKey: idempotencyKeyFor(storeId, attemptId, generation, nonce),
      paymongoIntentId: null, attachNo: 0, leaseId, leaseAtMs: nowMs, operationId, billingRevision, generationBillingRevision: billingRevision,
    };
    // Full overwrite: drops the previous generation's ready/failed fields.
    tx.set(attemptRef, { ...next, createdByUid: uid });
    return { kind: "work", work: { intentDocId, generation, paymongoIntentId: null, attachNo: 0, operationId, metaBillingRevision: billingRevision, nonce } };
  };

  const claimOnce = (forceNewGeneration: boolean): Promise<Claim> => adminDb.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const aSnap = await tx.get(attemptRef);
    const attempt = aSnap.exists ? (aSnap.data() as AttemptDoc) : null;
    if (attempt?.intentDocId && isSafeDocId(attempt.intentDocId)) {
      const bRef = intentsCol.doc(attempt.intentDocId);
      const bSnap = await tx.get(bRef);
      const bridge = bSnap.exists ? (bSnap.data() as PosPaymentIntentDoc) : undefined;
      if (reusable(bridge, sessionId, amountCentavos, methodId, nowMs)) {
        // Same amount, newer bill revision: keep the ONE payable QR (minting a
        // second one could let the customer pay twice) and record the revision
        // it is now confirmed against.
        if (bridge!.billingRevision !== billingRevision) {
          tx.set(bRef, { billingRevision }, { merge: true });
          tx.set(attemptRef, { billingRevision }, { merge: true });
          return { kind: "reuse", doc: { ...bridge!, billingRevision } };
        }
        return { kind: "reuse", doc: bridge! };
      }
      // Already being paid at PayMongo (no QR saved): re-check, never re-mint.
      if (awaitingWithoutQr(bridge, sessionId, amountCentavos, methodId)) return { kind: "recheck", doc: bridge! };
      if (!bridge && !forceNewGeneration) {
        const leaseAt = Number(attempt.leaseAtMs ?? attempt.startedAtMs);
        if (attempt.state === "creating" && nowMs - leaseAt < CREATING_LEASE_MS) {
          return { kind: "wait", intentDocId: attempt.intentDocId };
        }
        if (resumable(attempt, nowMs)) {
          // Stale lease or ambiguous failure: resume the SAME generation (same
          // bridge id and idempotency key, saved provider id) so an intent the
          // provider may already have created is picked up, not orphaned.
          tx.set(attemptRef, { state: "creating", leaseId, leaseAtMs: nowMs, billingRevision, resumedByUid: uid }, { merge: true });
          return {
            kind: "work",
            work: {
              intentDocId: attempt.intentDocId,
              generation: Number(attempt.generation),
              paymongoIntentId: typeof attempt.paymongoIntentId === "string" && isSafeDocId(attempt.paymongoIntentId) ? attempt.paymongoIntentId : null,
              attachNo: Number(attempt.attachNo ?? 0),
              // Exactly the first pass's provider parameters: PayMongo rejects
              // a replayed idempotency key whose parameters differ.
              operationId: attempt.operationId ?? null,
              metaBillingRevision: Number(attempt.generationBillingRevision ?? attempt.billingRevision ?? billingRevision),
              nonce: attempt.nonce!,
            },
          };
        }
      }
    }
    return newGeneration(tx, attempt, nowMs);
  });

  /** Merge into the attempt only while this request still holds its lease. */
  const writeIfLeaseHeld = (patch: Record<string, unknown>) => adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(attemptRef);
    if (!snap.exists || (snap.data() as AttemptDoc).leaseId !== leaseId) return false;
    tx.set(attemptRef, patch, { merge: true });
    return true;
  });

  /**
   * A QR-less bridge awaiting settlement: ask PayMongo about THAT intent.
   * Returns the response to send, or null when the intent was cancelled and a
   * fresh attempt may start.
   */
  const recheckQrLess = async (bridge: PosPaymentIntentDoc): Promise<NextResponse | null> => {
    let remote;
    try {
      remote = await getPaymentIntentViaApi({ getJson: defaultGetJson }, bridge.paymongoIntentId);
    } catch (e) {
      console.error("[paymongo/create-qr] re-check of a settling intent failed; refusing a new QR:", e);
      return inProgressResponse(bridge.id, bridge.paymongoIntentId);
    }
    if (remote.amountCentavos !== amountCentavos || remote.currency !== "PHP") {
      return inProgressResponse(bridge.id, bridge.paymongoIntentId);
    }
    const bRef = intentsCol.doc(bridge.id);
    if (remote.status === "awaiting_next_action" && remote.qr) {
      const qr = remote.qr;
      const updated = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(bRef);
        const cur = snap.exists ? (snap.data() as PosPaymentIntentDoc) : undefined;
        if (!awaitingWithoutQr(cur, sessionId, amountCentavos, methodId) || cur!.paymongoIntentId !== bridge.paymongoIntentId) return null;
        const patch = {
          qrData: qr.qrData,
          imageUrl: qr.imageUrl,
          expiresAtMs: qr.expiresAtFromApiMs ?? Date.now() + TEN_MINUTES_MS,
        };
        tx.set(bRef, patch, { merge: true });
        return { ...cur!, ...patch };
      });
      if (updated && reusable(updated, sessionId, amountCentavos, methodId, Date.now())) return qrResponse(updated, true);
      return inProgressResponse(bridge.id, bridge.paymongoIntentId);
    }
    if (remote.status === "cancelled") {
      // Can never be paid: retire the bridge so the next claim starts afresh.
      const retired = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(bRef);
        const cur = snap.exists ? (snap.data() as PosPaymentIntentDoc) : undefined;
        if (!awaitingWithoutQr(cur, sessionId, amountCentavos, methodId)) return false;
        tx.set(bRef, { status: "canceled" }, { merge: true });
        return true;
      });
      return retired ? null : inProgressResponse(bridge.id, bridge.paymongoIntentId);
    }
    // succeeded / processing / anything else: the webhook or a status poll settles it.
    return inProgressResponse(bridge.id, bridge.paymongoIntentId);
  };

  let claim: Claim = await claimOnce(false);
  if (claim.kind === "recheck") {
    const out = await recheckQrLess(claim.doc);
    if (out) return out;
    claim = await claimOnce(false);
    if (claim.kind === "recheck") return inProgressResponse(claim.doc.id, claim.doc.paymongoIntentId);
  }

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

  // 9. Create (or resume) the QR at PayMongo. At most one extra pass: when the
  // saved provider intent turns out not to belong to this attempt (a forged or
  // corrupted attempt doc), start a fresh generation instead of trusting it.
  let result: QrCreateResult | null = null;
  let work = claim.work;
  for (let pass = 0; ; pass++) {
    const metadata: QrhpMetadata = {
      storeId, sessionId, intentDocId: work.intentDocId, kind: "pos_session",
      attemptId, billingRevision: String(work.metaBillingRevision),
      ...(work.operationId ? { operationId: work.operationId } : {}),
    };
    try {
      result = await createOrResumeQrViaApi(
        { postJson: defaultPostJson, getJson: defaultGetJson },
        {
          amountCentavos,
          description: `${storeId} session ${sessionId}`,
          metadata,
          // PayMongo requires billing.email on the qrph payment method. We don't collect a
          // customer email at the till, so use a merchant address (receipts, if any, go here).
          billing: { name: `Shareat ${storeId}`, email: "pos@shareat.net" },
          // Recomputed, never read back from the attempt doc, so a tampered
          // attempt cannot replay another attempt's provider key.
          intentIdempotencyKey: idempotencyKeyFor(storeId, attemptId, work.generation, work.nonce),
          knownIntentId: work.paymongoIntentId,
          attachNo: work.attachNo,
          // Persist the provider id BEFORE anything else happens to it.
          onIntentCreated: async (paymongoIntentId) => {
            const held = await writeIfLeaseHeld({ paymongoIntentId, intentCreatedAtMs: Date.now() });
            if (!held) throw new Error("Payment attempt was taken over by another request");
          },
        },
      );
      break;
    } catch (e) {
      if (e instanceof IntentCorrelationError && pass === 0) {
        console.error(`[paymongo/create-qr] attempt ${storeId}/${attemptId} points at a foreign PayMongo intent; starting a new generation`);
        const next = await claimOnce(true);
        if (next.kind !== "work") break; // cannot happen with forceNewGeneration; fall through to 502
        work = next.work;
        continue;
      }
      console.error("[paymongo/create-qr] PayMongo QR creation failed:", e);
      // Release the lease so the cashier can retry straight away (best-effort:
      // a stale lease also expires after CREATING_LEASE_MS). An AMBIGUOUS
      // failure keeps the generation, so the retry replays the same idempotency
      // key / saved intent id; a definitive rejection starts a new one.
      const failureKind = isDefinitiveProviderRejection(e) || e instanceof IntentCorrelationError ? "definitive" : "ambiguous";
      await writeIfLeaseHeld({ state: "failed", failedAtMs: Date.now(), failureKind }).catch(() => {});
      // `reason` carries PayMongo's cleaned, human-readable detail (or a config/guard
      // message) so the cashier sees WHY (e.g. method not enabled, amount too low).
      return NextResponse.json({ error: "Could not start payment", reason: (e as Error).message }, { status: 502 });
    }
  }
  if (!result) return NextResponse.json({ error: "Could not start payment" }, { status: 502 });

  // 10. Persist the bridge doc AND a server-only reverse-index doc (PayMongo
  // intent id -> bridge-doc address) atomically, so the webhook can correlate
  // payment.paid events by payment_intent_id without relying on metadata
  // being echoed onto the payment resource (it isn't). The QR is only returned
  // to the till after this commits, and only by the request holding the lease.
  const paymongoIntentId = result.kind === "qr" ? result.parsed.paymongoIntentId : result.paymongoIntentId;
  const parsed: ParsedQr = result.kind === "qr"
    ? result.parsed
    // Already paid/processing at PayMongo: no QR to hand out. The bridge still
    // gets written so the webhook (redelivered) or a status poll can settle it.
    : { paymongoIntentId, qrData: null, imageUrl: null, expiresAtFromApiMs: null };
  const nowMs = Date.now();
  const doc: PosPaymentIntentDoc = {
    ...buildInitialIntentDoc({
      intentDocId: work.intentDocId, storeId, sessionId, amount, amountCentavos, methodId,
      createdByUid: uid, createdByLocalUserId: localUserId ?? null, parsed, nowMs,
    }),
    attemptId,
    operationId: work.operationId,
    billingRevision,
  };
  const intentRef = intentsCol.doc(work.intentDocId);
  const indexRef = adminDb.doc(`paymongoIntentIndex/${paymongoIntentId}`);
  let committed: "ok" | "lost" ;
  try {
    committed = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(attemptRef);
      const a = snap.exists ? (snap.data() as AttemptDoc) : null;
      if (!a || a.leaseId !== leaseId || a.intentDocId !== work.intentDocId) return "lost" as const;
      tx.set(intentRef, doc);
      tx.set(indexRef, { storeId, sessionId, intentDocId: work.intentDocId, createdAtMs: nowMs });
      tx.set(attemptRef, {
        state: "ready", readyAtMs: nowMs, paymongoIntentId, attachNo: result!.attachNo,
        ...(result!.kind === "qr" && result!.paymentMethodId ? { paymongoPaymentMethodId: result!.paymentMethodId } : {}),
      }, { merge: true });
      return "ok" as const;
    });
  } catch (e) {
    // Nothing above committed (one transaction). The provider id is already on
    // the attempt, so a retry resumes this intent instead of minting another.
    console.error("[paymongo/create-qr] saving the bridge failed:", e);
    await writeIfLeaseHeld({ state: "failed", failedAtMs: Date.now(), failureKind: "ambiguous" }).catch(() => {});
    return NextResponse.json({ error: "Could not save the payment. Try again." }, { status: 503 });
  }

  if (committed === "lost") {
    // Another request took over this attempt (our lease expired mid-call). It
    // owns the bridge; hand back its QR if it is ready, never a second one.
    const snap = await intentsCol.doc(work.intentDocId).get();
    const other = snap.exists ? (snap.data() as PosPaymentIntentDoc) : undefined;
    if (reusable(other, sessionId, amountCentavos, methodId, Date.now())) return qrResponse(other!, true);
    return NextResponse.json({ error: "Payment is already being started for this amount. Try again in a moment." }, { status: 409 });
  }
  if (result.kind === "in_progress") return inProgressResponse(doc.id, paymongoIntentId);
  return qrResponse(doc, false);
}
