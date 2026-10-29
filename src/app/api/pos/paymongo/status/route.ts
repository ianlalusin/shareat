import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import {
  getPaymentIntentViaApi,
  defaultGetJson,
  mapIntentStatusToDocStatus,
} from "@/lib/payments/paymongo/qrph.server";
import { isSafeDocId, checkPosPaymentAccess } from "@/lib/payments/paymongo/pos-route-guards.server";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  storeId: z.string().refine(isSafeDocId),
  sessionId: z.string().refine(isSafeDocId),
  intentDocId: z.string().refine(isSafeDocId),
});

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

  // 2. Validate input (IDs must be single Firestore path segments).
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { storeId, sessionId, intentDocId } = parsed.data;

  // 3. Authorize: active staff, cashier-capable role, assigned to this store.
  const access = await checkPosPaymentAccess(adminDb, decoded, storeId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: 403 });

  // 4. Load the bridge doc; it must belong to the requested store AND session.
  const ref = adminDb.doc(`stores/${storeId}/paymentIntents/${intentDocId}`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const doc = snap.data() as PosPaymentIntentDoc;
  if (doc.storeId !== storeId || doc.sessionId !== sessionId) {
    // Same answer as a missing doc: do not confirm intents of other sessions exist.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 5. Already terminal — no need to call PayMongo.
  if (doc.status === "paid" || doc.status === "failed") {
    return NextResponse.json({ status: doc.status });
  }

  // 6. Poll PayMongo for the current intent status.
  let remote;
  try {
    remote = await getPaymentIntentViaApi({ getJson: defaultGetJson }, doc.paymongoIntentId);
  } catch (e) {
    console.error("[paymongo/status] PayMongo poll failed:", e);
    return NextResponse.json({ status: doc.status }, { status: 502 });
  }
  const mapped = mapIntentStatusToDocStatus(remote.status);
  // Note: doc.status is already narrowed to non-terminal statuses here (paid/failed
  // returned above), so it can never already be "paid" — this only ever flips forward.
  if (mapped === "paid") {
    await ref.set({
      ...doc,
      status: "paid",
      paymongoPaymentId: remote.latestPaymentId ?? doc.paymongoPaymentId,
    });
    return NextResponse.json({ status: "paid" });
  }
  return NextResponse.json({ status: doc.status });
}
