import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDb, getAdminAuth } from "@/lib/firebase/admin";
import {
  getPaymentIntentViaApi,
  defaultGetJson,
  mapIntentStatusToDocStatus,
} from "@/lib/payments/paymongo/qrph.server";
import type { PosPaymentIntentDoc } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  storeId: z.string().min(1),
  sessionId: z.string().min(1),
  intentDocId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const adminAuth = getAdminAuth();
  const adminDb = getAdminDb();

  // 1. Authenticate the Firebase user (device).
  const authz = req.headers.get("authorization") ?? "";
  const idToken = authz.replace(/^Bearer\s+/i, "").trim();
  if (!idToken) return NextResponse.json({ error: "Missing token" }, { status: 401 });
  try {
    await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // 2. Validate input.
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  // sessionId is still validated by the zod schema (request contract) but no longer
  // needed here — the bridge doc is addressed by storeId + intentDocId after Task 10's relocation.
  const { storeId, intentDocId } = parsed.data;

  // 3. Load the bridge doc.
  const ref = adminDb.doc(`stores/${storeId}/paymentIntents/${intentDocId}`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const doc = snap.data() as PosPaymentIntentDoc;

  // 4. Already terminal — no need to call PayMongo.
  if (doc.status === "paid" || doc.status === "failed") {
    return NextResponse.json({ status: doc.status });
  }

  // 5. Poll PayMongo for the current intent status.
  const remote = await getPaymentIntentViaApi({ getJson: defaultGetJson }, doc.paymongoIntentId);
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
