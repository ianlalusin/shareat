import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { resolveExternalKeyScope, storeAllowed } from "@/lib/server/external-auth";

export const runtime = "nodejs";

// External read: per-employee performance metrics for ONE store + day, keyed by
// serverProfileId. Serving speed comes from the pre-aggregated analytics day doc
// (kitchen serve + server confirm times per profile); per-cashier sales are
// derived from a bounded receipts scan (final, non-refund) attributed to the
// operator via createdByUsername → the store-unique profile name. The ERP maps
// profileId → its own staff via staff.posProfileId, and sums across the month.
//   GET /api/external/staff-metrics?storeId=<id>&date=YYYY-MM-DD
export async function GET(request: Request) {
  const scope = resolveExternalKeyScope(request);
  if (scope.response) return scope.response;

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  const date = searchParams.get("date");
  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  if (!storeAllowed(scope, storeId)) return NextResponse.json({ error: "Forbidden for this store." }, { status: 403 });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Missing or invalid date. Use YYYY-MM-DD." }, { status: 400 });
  }

  const dayId = date.replace(/-/g, "");
  // Manila (UTC+8, no DST) calendar-day ms window for the receipts scan.
  const startMs = Date.parse(`${date}T00:00:00+08:00`);
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;

  type Metric = { serveMsSum: number; serveCount: number; confirmMsSum: number; confirmCount: number; grossSales: number; txCount: number };
  const metrics: Record<string, Metric> = {};
  const ensure = (pid: string): Metric =>
    (metrics[pid] ??= { serveMsSum: 0, serveCount: 0, confirmMsSum: 0, confirmCount: 0, grossSales: 0, txCount: 0 });
  const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  try {
    const db = getAdminDb();
    const [analyticsSnap, profilesSnap, receiptsSnap] = await Promise.all([
      db.doc(`stores/${storeId}/analytics/${dayId}`).get(),
      db.collection(`stores/${storeId}/serverProfiles`).get(),
      db.collection(`stores/${storeId}/receipts`)
        .where("createdAtClientMs", ">=", startMs)
        .where("createdAtClientMs", "<=", endMs)
        .get(),
    ]);

    // profileId ↔ name (names are unique per store).
    const staffNames: Record<string, string> = {};
    const nameToPid: Record<string, string> = {};
    profilesSnap.docs.forEach((d) => {
      const name = String((d.data() as any)?.name ?? "").trim();
      if (!name) return;
      staffNames[d.id] = name;
      nameToPid[name.toLowerCase()] = d.id;
    });

    // Serving speed — pre-aggregated per profile in the analytics day doc.
    if (analyticsSnap.exists) {
      const d = analyticsSnap.data() as any;
      const k = d?.kitchen ?? {};
      const s = d?.server ?? {};
      const merge = (msMap: Record<string, number>, cntMap: Record<string, number>, msField: "serveMsSum" | "confirmMsSum", cntField: "serveCount" | "confirmCount") => {
        for (const [pid, ms] of Object.entries(msMap ?? {})) ensure(pid)[msField] += num(ms);
        for (const [pid, c] of Object.entries(cntMap ?? {})) ensure(pid)[cntField] += num(c);
      };
      merge(k.servingMsSumByUser ?? {}, k.servingCountByUser ?? {}, "serveMsSum", "serveCount");
      merge(s.confirmMsSumByUser ?? {}, s.confirmCountByUser ?? {}, "confirmMsSum", "confirmCount");
      // Label any profile the doc knows about (e.g. deleted profiles) too.
      for (const [pid, name] of Object.entries((d?.staffNames ?? {}) as Record<string, string>)) {
        if (!staffNames[pid] && name) staffNames[pid] = String(name);
      }
    }

    // Per-cashier sales — bounded receipts scan; attribute by operator name → pid.
    for (const doc of receiptsSnap.docs) {
      const r = doc.data() as any;
      if (r?.status === "voided" || r?.isRefund === true) continue;
      const name = String(r?.createdByUsername ?? "").trim().toLowerCase();
      const pid = name ? nameToPid[name] : undefined;
      if (!pid) continue; // operator isn't a mapped local profile (e.g. admin/manager)
      const m = ensure(pid);
      m.grossSales += num(r?.total);
      m.txCount += 1;
    }

    const found = analyticsSnap.exists || receiptsSnap.size > 0;
    return NextResponse.json({ storeId, date, found, staffNames, metrics });
  } catch (err: any) {
    console.error("[external/staff-metrics] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch staff metrics." }, { status: 500 });
  }
}
