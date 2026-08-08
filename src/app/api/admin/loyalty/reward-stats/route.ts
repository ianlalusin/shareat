import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

const LOG_LIMIT = 60;

/**
 * Per-reward redemption monitoring for the admin Loyalty Rewards page.
 * loyaltyRedemptions is server-only, so the client cannot read it directly.
 * Aggregates claims and points spent, broken down by the store where each
 * redemption was applied, and returns a recent usage log.
 */
export async function GET(req: Request) {
  const authz = req.headers.get("authorization") || "";
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (!m) return bad("Missing Authorization Bearer token.", 401);

  let decoded: any;
  try {
    decoded = await getAdminAuth().verifyIdToken(m[1]);
  } catch {
    return bad("Invalid token.", 401);
  }

  const db = getAdminDb();
  try {
    await requireActiveStaff(db, decoded, ["admin", "manager"]);
  } catch (e: any) {
    return bad(e?.message || "Not authorized.", 403);
  }

  const url = new URL(req.url);
  const rewardId = url.searchParams.get("rewardId");
  if (!rewardId) return bad("rewardId is required.");

  try {
    const snap = await db.collection("loyaltyRedemptions").where("rewardId", "==", rewardId).get();

    let totalClaims = 0;
    let appliedClaims = 0;
    let pendingClaims = 0; // active hub vouchers not yet used at a store
    let expiredClaims = 0;
    let cancelledClaims = 0;
    let totalPointsSpent = 0; // points consumed by claims still in effect (applied or active)

    // store -> { claims, points } for redemptions consumed at a store (applied)
    const byStore = new Map<string, { claims: number; points: number }>();

    type Row = {
      id: string;
      ts: number;
      status: string;
      source: string;
      storeId: string | null;
      pointsCost: number;
      phone: string;
    };
    const rows: Row[] = [];

    snap.forEach((d) => {
      const r = d.data() as any;
      const status = String(r.status || "");
      const points = Math.floor(Number(r.pointsCost) || 0);
      const storeId: string | null = r.appliedStoreId ?? null;
      totalClaims++;
      if (status === "applied") {
        appliedClaims++;
        if (storeId) {
          const cur = byStore.get(storeId) ?? { claims: 0, points: 0 };
          cur.claims++;
          cur.points += points;
          byStore.set(storeId, cur);
        }
      } else if (status === "active") {
        pendingClaims++;
      } else if (status === "expired") {
        expiredClaims++;
      } else if (status === "cancelled") {
        cancelledClaims++;
      }
      if (status === "applied" || status === "active") totalPointsSpent += points;

      rows.push({
        id: d.id,
        ts: Number(r.createdAtClientMs) || 0,
        status,
        source: String(r.source || ""),
        storeId,
        pointsCost: points,
        phone: String(r.phone || ""),
      });
    });

    // Resolve store names for the stores involved (per-store breakdown + log).
    const storeIds = new Set<string>();
    byStore.forEach((_v, k) => storeIds.add(k));
    rows.forEach((r) => { if (r.storeId) storeIds.add(r.storeId); });
    const storeNames: Record<string, string> = {};
    await Promise.all(
      Array.from(storeIds).map(async (sid) => {
        try {
          const s = await db.doc(`stores/${sid}`).get();
          storeNames[sid] = (s.exists ? (s.data() as any)?.name : null) || sid;
        } catch {
          storeNames[sid] = sid;
        }
      })
    );

    const byStoreArr = Array.from(byStore.entries())
      .map(([storeId, v]) => ({ storeId, storeName: storeNames[storeId] || storeId, claims: v.claims, points: v.points }))
      .sort((a, b) => b.points - a.points);

    const recent = rows
      .sort((a, b) => b.ts - a.ts)
      .slice(0, LOG_LIMIT)
      .map((r) => ({
        id: r.id,
        ts: r.ts,
        status: r.status,
        source: r.source,
        storeName: r.storeId ? (storeNames[r.storeId] || r.storeId) : null,
        pointsCost: r.pointsCost,
        phone: r.phone,
      }));

    return NextResponse.json({
      ok: true,
      totals: {
        totalClaims,
        appliedClaims,
        pendingClaims,
        expiredClaims,
        cancelledClaims,
        totalPointsSpent,
        storeCount: byStoreArr.length,
      },
      byStore: byStoreArr,
      recent,
    });
  } catch (e: any) {
    return bad(e?.message || "Failed to load reward stats.", 500);
  }
}
