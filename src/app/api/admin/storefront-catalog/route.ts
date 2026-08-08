import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { rebuildStorefrontCatalog } from "@/lib/server/storefront-catalog";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

type Op = "get" | "rebuild" | "set-config" | "set-accepts" | "set-availability";

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    const staff = await requireActiveStaff(db, decoded, ["admin", "manager"]);

    const body = await req.json().catch(() => ({}));
    const op = String(body?.op || "") as Op;
    const storeId = body?.storeId ? String(body.storeId) : null;

    if (!storeId) return bad("storeId required.", 400);
    if (!staff.isPlatformAdmin && !staff.assignedStoreIds.includes(storeId)) {
      return bad("No access to this store.", 403);
    }

    switch (op) {
      case "get": {
        const [catSnap, cfgSnap, storeSnap] = await Promise.all([
          db.doc(`stores/${storeId}/storefrontCatalog/main`).get(),
          db.doc(`stores/${storeId}/storefrontConfig/main`).get(),
          db.doc(`stores/${storeId}`).get(),
        ]);
        const cat = catSnap.exists ? (catSnap.data() as any) : null;
        const sd = storeSnap.exists ? (storeSnap.data() as any) : {};
        return NextResponse.json({
          ok: true,
          catalog: cat ? { updatedAtMs: cat.updatedAtMs ?? null, itemCount: cat.itemCount ?? 0 } : null,
          config: cfgSnap.exists ? cfgSnap.data() : null,
          acceptsOnlineOrders: !!sd?.acceptsOnlineOrders,
          onlineOrderMode: sd?.onlineOrderMode === "auto" ? "auto" : "manual",
          onlineOrderManualOpen: sd?.onlineOrderManualOpen !== false,
        });
      }

      case "rebuild": {
        const result = await rebuildStorefrontCatalog(db, storeId);
        return NextResponse.json({ ok: true, ...result });
      }

      case "set-config": {
        const c = body?.config ?? {};
        const config: Record<string, any> = {
          pickupEnabled: c.pickupEnabled !== false,
          deliveryEnabled: !!c.deliveryEnabled,
          deliveryFee: Math.max(0, Number(c.deliveryFee ?? 0)) || 0,
          minOrder: Math.max(0, Number(c.minOrder ?? 0)) || 0,
          prepEtaMinutes: Math.max(0, Number(c.prepEtaMinutes ?? 0)) || 0,
          serviceAreaNote: String(c.serviceAreaNote ?? "").slice(0, 300),
          currency: "PHP",
          updatedAt: FieldValue.serverTimestamp(),
        };
        await db.doc(`stores/${storeId}/storefrontConfig/main`).set(config, { merge: true });
        return NextResponse.json({ ok: true });
      }

      case "set-accepts": {
        await db.doc(`stores/${storeId}`).set(
          { acceptsOnlineOrders: !!body?.acceptsOnlineOrders },
          { merge: true }
        );
        return NextResponse.json({ ok: true });
      }

      // One-click availability for the Online Orders page. Picking any state
      // enrolls the store (acceptsOnlineOrders:true); the open/closed effect
      // then follows the mode:
      //   - "auto"   ⇒ store hours decide (openingTime/closingTime)
      //   - "manual" ⇒ manualOpen decides (force open / force closed)
      case "set-availability": {
        const mode = body?.mode === "auto" ? "auto" : "manual";
        const patch: Record<string, any> = {
          acceptsOnlineOrders: true,
          onlineOrderMode: mode,
        };
        if (mode === "manual") patch.onlineOrderManualOpen = !!body?.manualOpen;
        await db.doc(`stores/${storeId}`).set(patch, { merge: true });
        return NextResponse.json({ ok: true });
      }

      default:
        return bad(`Unknown op: ${op}`, 400);
    }
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /required/i.test(message) ? 400
      : /not allowed|no access|not a staff/i.test(message) ? 403
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
