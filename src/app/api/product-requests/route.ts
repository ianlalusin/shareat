import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { buildNameKey, canEnableAddon } from "@/lib/product-requests/shared";
import { slugify } from "@/lib/utils/slugify";
import { normalizeUom } from "@/lib/uom";

/**
 * Product registration requests: a manager applies for a new global catalog
 * product, an admin approves or declines.
 *
 * Every write to `productRequests` goes through here. The collection is
 * client-read-only in firestore.rules for two reasons rules cannot cover:
 *
 *  - submit and approve both need cross-document duplicate queries, and rules
 *    cannot run queries;
 *  - requester identity, store name, nameKey, status and the reviewer fields
 *    must be stamped server-side so a crafted client write cannot forge them.
 *
 * Approve additionally writes `products` and `addonCategories`, which
 * firestore.rules restricts to isAdmin() — so it has to run on the Admin SDK
 * regardless.
 */

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

type Op = "submit" | "cancel" | "approve" | "reject";

/** Client-generated ids are used as Firestore doc ids and Storage path segments. */
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/** Only accept image URLs we actually issued, not arbitrary remote URLs. */
function isAllowedImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(value);
}

/**
 * Scan the live catalog for a product whose normalized name matches `nameKey`.
 *
 * A `where("name","==",…)` equality query would miss the normalization variants
 * this is meant to catch ("Coke Zero" vs "coke  zero"), so this reads the
 * catalog with a 4-field projection instead. Consistent with the existing
 * full-catalog reads in /manager/inventory and AddInventoryDialog.
 *
 * If `products` ever grows past a few thousand docs, denormalize `nameKey` onto
 * the product doc and swap this for an equality query.
 */
async function findCatalogDuplicate(db: Firestore, nameKey: string) {
  const snap = await db
    .collection("products")
    .select("name", "variant", "variantLabel", "isArchived")
    .get();

  const hit = snap.docs.find((d) => {
    const x = d.data() as any;
    if (x?.isArchived === true) return false;
    return buildNameKey(String(x?.name ?? ""), x?.variantLabel ?? x?.variant ?? null) === nameKey;
  });

  return hit ? { id: hit.id, name: String((hit.data() as any)?.name ?? "") } : null;
}

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    // Minimum bar for every op; approve/reject narrow to admins below.
    const staff = await requireActiveStaff(db, decoded, ["admin", "manager"]);

    const body = await req.json().catch(() => ({}));
    const op = String(body?.op || "") as Op;

    function requireAdmin() {
      if (!staff.isPlatformAdmin) {
        throw new Error("Not allowed: only platform admins can review product requests.");
      }
    }

    switch (op) {
      // ---------------------------------------------------------------------
      case "submit": {
        const storeId = String(body?.storeId || "").trim();
        if (!storeId) return bad("storeId is required.", 400);
        if (!staff.isPlatformAdmin && !staff.assignedStoreIds.includes(storeId)) {
          return bad("No access to this store.", 403);
        }

        const requestId = String(body?.requestId || "").trim();
        if (requestId && !ID_RE.test(requestId)) return bad("Invalid requestId.", 400);

        const name = String(body?.name || "").trim();
        if (name.length < 2) return bad("Product name must be at least 2 characters.", 400);

        const requestKind = String(body?.requestKind || "");
        if (requestKind !== "addon" && requestKind !== "product") {
          return bad("requestKind must be 'addon' or 'product'.", 400);
        }

        const variant = String(body?.variant || "").trim() || null;
        const subCategory = String(body?.subCategory || "").trim() || null;
        const uom = normalizeUom(body?.uom);
        const barcode = String(body?.barcode || "").trim() || null;
        const description = String(body?.description || "").trim() || null;
        const justification = String(body?.justification || "").trim() || null;

        const suggestedPrice = Number(body?.suggestedPrice ?? 0);
        if (!Number.isFinite(suggestedPrice) || suggestedPrice < 0) {
          return bad("Suggested price must be a positive number.", 400);
        }
        const cost = Number(body?.cost ?? 0);
        if (!Number.isFinite(cost) || cost < 0) return bad("Cost must be a positive number.", 400);

        const imageUrlRaw = body?.imageUrl ?? null;
        if (imageUrlRaw !== null && !isAllowedImageUrl(imageUrlRaw)) {
          return bad("Invalid image URL.", 400);
        }
        const imageUrl: string | null = imageUrlRaw;

        // Add-on requests must arrive sellable: /manager/inventory refuses to
        // flip isAddon without a price > 0 and a kitchen station, so collect
        // both here rather than approving something half-usable.
        let kitchenLocationId = String(body?.kitchenLocationId || "").trim() || null;
        let kitchenLocationName: string | null = null;
        if (requestKind === "addon") {
          if (suggestedPrice <= 0) {
            return bad("An add-on needs a suggested price greater than zero.", 400);
          }
          if (!kitchenLocationId) {
            return bad("An add-on needs a kitchen station.", 400);
          }
        }
        if (kitchenLocationId) {
          const klSnap = await db.doc(`stores/${storeId}/kitchenLocations/${kitchenLocationId}`).get();
          if (!klSnap.exists || (klSnap.data() as any)?.isActive === false) {
            return bad("That kitchen station no longer exists or is inactive.", 400);
          }
          kitchenLocationName = String((klSnap.data() as any)?.name ?? "") || null;
        }

        const nameKey = buildNameKey(name, variant);

        // Duplicate check A — another store already has this queued.
        const pendingDup = await db
          .collection("productRequests")
          .where("nameKey", "==", nameKey)
          .get();
        const openDup = pendingDup.docs.find((d) => (d.data() as any)?.status === "pending");
        if (openDup) {
          const d = openDup.data() as any;
          return bad(
            d?.storeId === storeId
              ? `You already have a pending request for "${name}".`
              : `${d?.storeName || "Another store"} already has a pending request for "${name}". Once an admin approves it you can import it from Menu.`,
            409
          );
        }

        // Duplicate check B — it is already in the catalog.
        const catalogDup = await findCatalogDuplicate(db, nameKey);
        if (catalogDup) {
          return bad(
            `"${catalogDup.name}" is already in the global catalog. Add it to your store from Menu → Add Products to Inventory.`,
            409
          );
        }

        const storeSnap = await db.doc(`stores/${storeId}`).get();
        if (!storeSnap.exists) return bad("Store not found.", 404);
        const storeName = String((storeSnap.data() as any)?.name ?? "") || storeId;

        const ref = requestId
          ? db.collection("productRequests").doc(requestId)
          : db.collection("productRequests").doc();

        // .create() rejects an existing id, so a replayed submit cannot
        // overwrite a request that is already under review.
        await ref.create({
          id: ref.id,
          status: "pending",
          requestKind,
          name,
          variant,
          description,
          subCategory,
          uom,
          barcode,
          imageUrl,
          nameKey,
          storeId,
          storeName,
          suggestedPrice,
          cost,
          kitchenLocationId,
          kitchenLocationName,
          justification,
          requestedByUid: staff.uid,
          requestedByName: staff.displayName || decoded.email || staff.uid,
          requestedAt: FieldValue.serverTimestamp(),
          reviewedByUid: null,
          reviewedByName: null,
          reviewedAt: null,
          reviewNote: null,
          approvedProductId: null,
          autoActivation: null,
          autoActivationNote: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({ ok: true, id: ref.id });
      }

      // ---------------------------------------------------------------------
      case "cancel": {
        const requestId = String(body?.requestId || "").trim();
        if (!requestId) return bad("requestId is required.", 400);

        const ref = db.collection("productRequests").doc(requestId);
        const snap = await ref.get();
        if (!snap.exists) return bad("Request not found.", 404);
        const r = snap.data() as any;

        if (!staff.isPlatformAdmin && r.requestedByUid !== staff.uid) {
          return bad("Not allowed: only the manager who raised this request can withdraw it.", 403);
        }
        if (r.status !== "pending") return bad(`Request is already ${r.status}.`, 409);

        await ref.update({
          status: "cancelled",
          reviewedByUid: staff.uid,
          reviewedByName: staff.displayName || staff.uid,
          reviewedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({ ok: true });
      }

      // ---------------------------------------------------------------------
      case "reject": {
        requireAdmin();
        const requestId = String(body?.requestId || "").trim();
        if (!requestId) return bad("requestId is required.", 400);

        const reviewNote = String(body?.reviewNote || "").trim();
        if (reviewNote.length < 3) {
          return bad("A reason is required so the manager knows why it was declined.", 400);
        }

        const ref = db.collection("productRequests").doc(requestId);
        const snap = await ref.get();
        if (!snap.exists) return bad("Request not found.", 404);
        const r = snap.data() as any;
        if (r.status !== "pending") return bad(`Request is already ${r.status}.`, 409);

        await ref.update({
          status: "rejected",
          reviewNote,
          reviewedByUid: staff.uid,
          reviewedByName: staff.displayName || staff.uid,
          reviewedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        return NextResponse.json({ ok: true });
      }

      // ---------------------------------------------------------------------
      case "approve": {
        requireAdmin();
        const requestId = String(body?.requestId || "").trim();
        if (!requestId) return bad("requestId is required.", 400);
        const force = body?.force === true;
        const reviewNote = String(body?.reviewNote || "").trim() || null;

        const ref = db.collection("productRequests").doc(requestId);
        const snap = await ref.get();
        if (!snap.exists) return bad("Request not found.", 404);
        const r = snap.data() as any;

        // Makes a double-click, or two admins in two tabs, a clean no-op.
        if (r.status !== "pending") return bad(`Request is already ${r.status}.`, 409);

        // Re-scan: an admin may have created the product by hand since submit.
        if (!force) {
          const dup = await findCatalogDuplicate(db, String(r.nameKey || ""));
          if (dup) {
            return NextResponse.json(
              {
                ok: false,
                error: `"${dup.name}" already exists in the catalog. Decline this request instead — the store can import the existing product from Menu.`,
                duplicateProductId: dup.id,
              },
              { status: 409 }
            );
          }
        }

        const productRef = db.collection("products").doc();
        // The inventory doc id IS the product id, matching handleAddItems in
        // /manager/inventory so both import paths produce identical records.
        const invRef = db.doc(`stores/${r.storeId}/inventory/${productRef.id}`);

        const uom = normalizeUom(r.uom);
        const subCategory = String(r.subCategory || "").trim();

        // Degrade rather than fail: if the station was deleted or deactivated
        // between submit and approve, still create the product and import it —
        // the manager flips the add-on switch from /manager/inventory in two
        // clicks. Blocking a global approval on one store's config would leave
        // the admin with no way forward but to decline a legitimate request.
        let kitchenLocationId: string | null = r.kitchenLocationId || null;
        let kitchenLocationName: string | null = r.kitchenLocationName || null;
        if (kitchenLocationId) {
          const klSnap = await db
            .doc(`stores/${r.storeId}/kitchenLocations/${kitchenLocationId}`)
            .get();
          if (!klSnap.exists || (klSnap.data() as any)?.isActive === false) {
            kitchenLocationId = null;
            kitchenLocationName = null;
          }
        }

        const wantsAddon = r.requestKind === "addon";
        const isAddon = wantsAddon && canEnableAddon(Number(r.suggestedPrice ?? 0), kitchenLocationId);
        const autoActivation = !wantsAddon || isAddon ? "activated" : "activated_without_addon";
        const autoActivationNote =
          autoActivation === "activated"
            ? null
            : "Add-on not enabled: the requesting store's kitchen station is missing or inactive. Pick one in Menu, then flip the Is Add-on switch.";

        const batch = db.batch();

        // (a) The global catalog entry. isActive + isSku are what makes it show
        // up in every other manager's "Add Products to Inventory" picker.
        batch.set(productRef, {
          id: productRef.id,
          name: r.name,
          variant: r.variant || "",
          description: r.description || "",
          kind: "single",
          isSku: true,
          groupId: null,
          groupName: null,
          variantLabel: null,
          optionGroupIds: [],
          // Product.category is vestigial — /admin/menu/products hard-codes
          // "Add-on" for every product it creates, and analytics group by
          // subCategory. Keep it uniform so this path produces the same shape.
          category: "Add-on",
          subCategory: subCategory || "Uncategorized",
          uom,
          barcode: r.barcode || "",
          imageUrl: r.imageUrl || null,
          isActive: true,
          isArchived: false,
          showOnStorefront: false,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // (b) Mirror the sub-category, exactly as /admin/menu/products does.
        if (subCategory) {
          const slug = slugify(subCategory);
          if (slug) {
            batch.set(
              db.doc(`addonCategories/${slug}`),
              {
                id: slug,
                name: subCategory,
                slug,
                isActive: true,
                sortOrder: 0,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          }
        }

        // (c) Auto-import into the requesting store at the suggested price.
        batch.set(invRef, {
          id: productRef.id,
          productId: productRef.id,
          name: r.name,
          variantLabel: r.variant || null,
          category: "Add-on",
          subCategory: subCategory || "",
          uom,
          barcode: r.barcode || null,
          // Deliberately null, NOT a copy of (a)'s imageUrl above.
          // `inventory.imageUrl` is a PURE per-store override: null means "this
          // store has no photo of its own, show the global
          // products/{id}.imageUrl", which every display surface now resolves
          // (`inventoryItem.imageUrl ?? product.imageUrl`). Seeding a copy here
          // makes the row look like a deliberate local choice, so it keeps
          // winning over the global photo after an admin promotes or clears it
          // — and, because the admin's own upload path writes a deterministic
          // Items/{productId}.webp, the stale copy's URL eventually 404s.
          imageUrl: null,
          cost: Number(r.cost ?? 0),
          sellingPrice: Number(r.suggestedPrice ?? 0),
          isActive: true,
          isAddon,
          isArchived: false,
          kitchenLocationId,
          kitchenLocationName,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        // (d) Close the request.
        batch.update(ref, {
          status: "approved",
          approvedProductId: productRef.id,
          autoActivation,
          autoActivationNote,
          reviewNote,
          reviewedByUid: staff.uid,
          reviewedByName: staff.displayName || staff.uid,
          reviewedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        await batch.commit();

        return NextResponse.json({
          ok: true,
          productId: productRef.id,
          autoActivation,
          warning: autoActivationNote,
        });
      }

      default:
        return bad(`Unknown op: ${op}`, 400);
    }
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /required|already exists/i.test(message)
      ? 400
      : /not allowed|no access|not a staff|not active/i.test(message)
        ? 403
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
