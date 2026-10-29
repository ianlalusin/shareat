import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { rebuildStorefrontCatalog } from "@/lib/server/storefront-catalog";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

type Op = "get" | "rebuild" | "set-config" | "set-accepts" | "set-availability" | "set-delivery-enabled";

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1], true);

    const db = getAdminDb();
    const staff = await requireActiveStaff(db, decoded, ["admin", "manager", "cashier"]);

    const body = await req.json().catch(() => ({}));
    const op = String(body?.op || "") as Op;
    const storeId = body?.storeId ? String(body.storeId) : null;

    if (!storeId) return bad("storeId required.", 400);
    if (!staff.isPlatformAdmin && !staff.assignedStoreIds.includes(storeId)) {
      return bad("No access to this store.", 403);
    }

    // Cashiers are only admitted to this route for the two day-to-day on/off
    // switches below (set-availability, set-delivery-enabled) — e.g. closing
    // early, or pausing delivery when no rider is on shift. Catalog rebuilds,
    // the online-orders master enrollment switch, and pricing/fee config stay
    // manager-and-up: widening the route's own role gate above would hand
    // cashiers those too, not just the one op they were meant to get.
    const isManagerOrAbove = staff.isPlatformAdmin || staff.role === "manager";

    switch (op) {
      case "get": {
        if (!isManagerOrAbove) return bad("Manager access required for this action.", 403);
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
        if (!isManagerOrAbove) return bad("Manager access required for this action.", 403);
        const result = await rebuildStorefrontCatalog(db, storeId);
        return NextResponse.json({ ok: true, ...result });
      }

      case "set-config": {
        if (!isManagerOrAbove) return bad("Manager access required for this action.", 403);
        const c = body?.config ?? {};
        const config: Record<string, any> = {
          pickupEnabled: c.pickupEnabled !== false,
          // Opt-OUT, exactly like pickupEnabled above and like every READER of
          // this doc: Shareat Website functions/index.js:1541,
          // DeliveryPricingSettings.tsx and OnlineOrdersClient.tsx all use
          // `!== false`, so an ABSENT field means ENABLED. This was `!!`, the
          // opt-IN reading — because set-config rebuilds the whole document
          // rather than patching it, any caller that omitted the field would
          // have silently paused delivery for the branch. `set-delivery-enabled`
          // below deliberately keeps `!!`: that op IS the explicit on/off
          // switch, and its caller always sends a concrete boolean.
          deliveryEnabled: c.deliveryEnabled !== false,
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
        if (!isManagerOrAbove) return bad("Manager access required for this action.", 403);
        await db.doc(`stores/${storeId}`).set(
          { acceptsOnlineOrders: !!body?.acceptsOnlineOrders },
          { merge: true }
        );
        return NextResponse.json({ ok: true });
      }

      // One-click availability for the Online Orders page. Enrollment
      // (acceptsOnlineOrders) is a separate, explicit switch on the store-edit
      // dialog now — this op only ever sets the open/closed effect, so it must
      // NOT touch acceptsOnlineOrders (it used to force it to true, which
      // meant visiting this page could silently re-enroll a store an admin
      // had just disabled). Mode:
      //   - "auto"   ⇒ store hours decide (openingTime/closingTime)
      //   - "manual" ⇒ manualOpen decides (force open / force closed)
      case "set-availability": {
        const mode = body?.mode === "auto" ? "auto" : "manual";
        const patch: Record<string, any> = {
          onlineOrderMode: mode,
        };
        if (mode === "manual") patch.onlineOrderManualOpen = !!body?.manualOpen;
        await db.doc(`stores/${storeId}`).set(patch, { merge: true });
        return NextResponse.json({ ok: true });
      }

      // Pause/resume delivery independent of pickup — e.g. no rider on shift
      // right now. Only touches this one field (merge:true), unlike
      // set-config above which reconstructs the whole config document.
      case "set-delivery-enabled": {
        await db.doc(`stores/${storeId}/storefrontConfig/main`).set(
          { deliveryEnabled: !!body?.deliveryEnabled, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
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
