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
    const snap = await db.collection("customers").get();
    let totalAccounts = 0;
    let totalPointsOutstanding = 0;
    snap.docs.forEach((d) => {
      const data = d.data() as any;
      totalAccounts += 1;
      totalPointsOutstanding += Number(data.pointsBalance) || 0;
    });

    // totalPointsEarnedEver — best effort: scan ledgerentries with type earn
    // across all customers. Expensive but one-shot.
    let totalPointsEarnedEver = 0;
    const earnQ = await db.collectionGroup("pointsLedger").where("type", "==", "earn").get();
    earnQ.docs.forEach((d) => {
      totalPointsEarnedEver += Number(d.data().points) || 0;
    });

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
