import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const maxDuration = 300;

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * One-shot admin endpoint to rebuild loyaltyStats/global by scanning
 * the customers collection. Run after first deploy or anytime the
 * aggregate is suspected to drift.
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded: any;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1]);
  } catch {
    return bad("Invalid token.", 401);
  }

  const uid = decoded.uid;
  if (!uid) return bad("Invalid token.", 401);

  const db = getAdminDb();
  const staffSnap = await db.doc(`staff/${uid}`).get();
  if (!staffSnap.exists) return bad("Not a staff member.", 403);
  const staffData = staffSnap.data() as any;
  if (staffData.status !== "active") return bad("Staff not active.", 403);
  const isAdmin = staffData.role === "admin" || decoded.platformAdmin === true;
  if (!isAdmin) return bad("Admin role required.", 403);

  try {
    // Paginate both scans so a large customer base / ledger can't exhaust
    // function memory. Cursor on document id (__name__) — no composite index
    // needed (single equality + name ordering uses the automatic index).
    let totalAccounts = 0;
    let totalPointsOutstanding = 0;
    {
      const pageSize = 500;
      let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      for (;;) {
        let q = db.collection("customers").orderBy("__name__").limit(pageSize);
        if (last) q = q.startAfter(last);
        const page = await q.get();
        if (page.empty) break;
        for (const d of page.docs) {
          totalAccounts += 1;
          totalPointsOutstanding += Number((d.data() as any).pointsBalance) || 0;
        }
        if (page.size < pageSize) break;
        last = page.docs[page.docs.length - 1];
      }
    }

    // totalPointsEarnedEver — scan earn ledger entries across all customers.
    let totalPointsEarnedEver = 0;
    {
      const pageSize = 1000;
      let last: FirebaseFirestore.QueryDocumentSnapshot | null = null;
      for (;;) {
        let q = db
          .collectionGroup("pointsLedger")
          .where("type", "==", "earn")
          .orderBy("__name__")
          .limit(pageSize);
        if (last) q = q.startAfter(last);
        const page = await q.get();
        if (page.empty) break;
        for (const d of page.docs) {
          totalPointsEarnedEver += Number((d.data() as any).points) || 0;
        }
        if (page.size < pageSize) break;
        last = page.docs[page.docs.length - 1];
      }
    }

    await db.doc("loyaltyStats/global").set(
      {
        totalAccounts,
        totalPointsOutstanding,
        totalPointsEarnedEver,
        rebuiltAt: FieldValue.serverTimestamp(),
        rebuiltByUid: uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({
      ok: true,
      totalAccounts,
      totalPointsOutstanding,
      totalPointsEarnedEver,
    });
  } catch (err: any) {
    console.error("[rebuild-stats] failed:", err);
    return bad(err.message || "Rebuild failed.", 500);
  }
}
