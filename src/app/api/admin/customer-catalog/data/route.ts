import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function GET(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    const staff = await requireActiveStaff(db, decoded, ["admin", "manager"]);

    const url = new URL(req.url);
    const storeId = String(url.searchParams.get("storeId") || "");

    // Global catalog
    const itemsSnap = await db.collection("catalogItems").orderBy("name", "asc").get();
    const items = itemsSnap.docs.map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        name: String(x.name ?? ""),
        category: String(x.category ?? ""),
        price: Number(x.price ?? 0),
        imageUrl: x.imageUrl ?? null,
        isAvailable: x.isAvailable !== false,
        isArchived: x.isArchived === true,
        linkedPosProductId: x.linkedPosProductId ?? null,
        linkedPosProductName: x.linkedPosProductName ?? null,
      };
    });

    // Categories (CUSTOMER side uses `categories` collection)
    const catSnap = await db.collection("categories").orderBy("sortOrder", "asc").get();
    const categories = catSnap.docs.map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        name: String(x.name ?? ""),
        isActive: x.isActive !== false,
        sortOrder: Number(x.sortOrder ?? 0),
      };
    }).filter((c) => c.isActive);

    // Stores list — limit to what this user can manage.
    let storesQ = db.collection("stores").where("isActive", "==", true);
    const storesSnap = await storesQ.get();
    const stores = storesSnap.docs
      .map((d) => {
        const x = d.data() as any;
        return { storeId: d.id, name: String(x.name ?? d.id) };
      })
      .filter((s) =>
        staff.isPlatformAdmin || staff.assignedStoreIds.includes(s.storeId)
      );

    // Per-store cache for the requested store
    let storeItems: any[] = [];
    let storeCacheUpdatedAtMs: number | null = null;
    if (storeId) {
      // Enforce store access for non-platform-admin
      if (!staff.isPlatformAdmin && !staff.assignedStoreIds.includes(storeId)) {
        return bad("No access to this store.", 403);
      }
      const cacheSnap = await db.doc(`stores/${storeId}/catalogCache/main`).get();
      if (cacheSnap.exists) {
        const data = cacheSnap.data() as any;
        storeItems = Array.isArray(data?.items) ? data.items : [];
        storeCacheUpdatedAtMs = Number(data?.updatedAtMs ?? 0) || null;
      }
    }

    return NextResponse.json({
      ok: true,
      items,
      categories,
      stores,
      storeId: storeId || null,
      storeItems,
      storeCacheUpdatedAtMs,
    });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|no access/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
