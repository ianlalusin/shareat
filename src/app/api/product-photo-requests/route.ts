import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

/**
 * Local (per-store) item photo submissions, and their admin promote/reject
 * review. Every write goes through here — productPhotoRequests is
 * client-read-only in firestore.rules, same reasoning as productRequests:
 * status/reviewer fields must be stamped server-side, not trusted from the
 * client, and promote/reject also write products/{id}.imageUrl, which
 * firestore.rules restricts to isAdmin().
 *
 * See docs/superpowers/specs/2026-08-12-item-photo-local-global-design.md.
 */

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

type Op = "submit" | "remove" | "promote" | "reject";

/** Only accept image URLs we actually issued, not arbitrary remote URLs. */
function isAllowedImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(value);
}

function requestId(storeId: string, productId: string) {
  return `${storeId}_${productId}`;
}

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);
    const db = getAdminDb();

    const body = await req.json().catch(() => ({}));
    const op = String(body?.op || "") as Op;

    switch (op) {
      // ---------------------------------------------------------------------
      case "submit": {
        const storeId = String(body?.storeId || "").trim();
        const productId = String(body?.productId || "").trim();
        if (!storeId || !productId) return bad("storeId and productId are required.", 400);

        const staff = await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager"]);

        const imageUrl = body?.imageUrl;
        if (!isAllowedImageUrl(imageUrl)) return bad("Invalid image URL.", 400);

        const productSnap = await db.doc(`products/${productId}`).get();
        if (!productSnap.exists) return bad("Product not found.", 404);
        const productName = String((productSnap.data() as any)?.name ?? "") || productId;

        const storeSnap = await db.doc(`stores/${storeId}`).get();
        if (!storeSnap.exists) return bad("Store not found.", 404);
        const storeName = String((storeSnap.data() as any)?.name ?? "") || storeId;

        const invRef = db.doc(`stores/${storeId}/inventory/${productId}`);
        const invSnap = await invRef.get();
        if (!invSnap.exists) return bad("This item is not in that store's inventory.", 404);

        const ref = db.collection("productPhotoRequests").doc(requestId(storeId, productId));
        const batch = db.batch();
        batch.set(ref, {
          id: ref.id,
          storeId,
          storeName,
          productId,
          productName,
          status: "pending",
          imageUrl,
          submittedByUid: staff.uid,
          submittedByName: decoded.name || decoded.email || staff.uid,
          submittedAt: FieldValue.serverTimestamp(),
          reviewedByUid: null,
          reviewedByName: null,
          reviewedAt: null,
        });
        batch.update(invRef, { imageUrl, updatedAt: FieldValue.serverTimestamp() });
        await batch.commit();

        return NextResponse.json({ ok: true, id: ref.id });
      }

      // ---------------------------------------------------------------------
      case "remove": {
        const storeId = String(body?.storeId || "").trim();
        const productId = String(body?.productId || "").trim();
        if (!storeId || !productId) return bad("storeId and productId are required.", 400);

        await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager"]);

        const invRef = db.doc(`stores/${storeId}/inventory/${productId}`);
        const invSnap = await invRef.get();
        if (!invSnap.exists) return bad("This item is not in that store's inventory.", 404);

        const ref = db.collection("productPhotoRequests").doc(requestId(storeId, productId));
        const batch = db.batch();
        batch.update(invRef, { imageUrl: null, updatedAt: FieldValue.serverTimestamp() });
        batch.delete(ref);
        await batch.commit();

        return NextResponse.json({ ok: true });
      }

      // ---------------------------------------------------------------------
      case "promote": {
        const staff = await requireActiveStaff(db, decoded, ["admin"]);

        const reqId = String(body?.requestId || "").trim();
        if (!reqId) return bad("requestId is required.", 400);

        const ref = db.collection("productPhotoRequests").doc(reqId);
        const snap = await ref.get();
        if (!snap.exists) return bad("Request not found.", 404);
        const r = snap.data() as any;
        if (r.status !== "pending") return bad(`Request is already ${r.status}.`, 409);

        const batch = db.batch();
        batch.update(db.doc(`products/${r.productId}`), {
          imageUrl: r.imageUrl,
          updatedAt: FieldValue.serverTimestamp(),
        });
        batch.update(ref, {
          status: "approved",
          reviewedByUid: staff.uid,
          reviewedByName: staff.displayName || staff.uid,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();

        return NextResponse.json({ ok: true });
      }

      // ---------------------------------------------------------------------
      case "reject": {
        const staff = await requireActiveStaff(db, decoded, ["admin"]);

        const reqId = String(body?.requestId || "").trim();
        if (!reqId) return bad("requestId is required.", 400);

        const ref = db.collection("productPhotoRequests").doc(reqId);
        const snap = await ref.get();
        if (!snap.exists) return bad("Request not found.", 404);
        const r = snap.data() as any;
        if (r.status === "rejected") return bad("Request is already rejected.", 409);

        const batch = db.batch();

        // Only clear the global image if it's still THIS request's photo — an
        // intervening different promotion (another store, approved later)
        // must not be clobbered by rejecting a stale one.
        if (r.status === "approved") {
          const productRef = db.doc(`products/${r.productId}`);
          const productSnap = await productRef.get();
          if (productSnap.exists && (productSnap.data() as any)?.imageUrl === r.imageUrl) {
            batch.update(productRef, { imageUrl: null, updatedAt: FieldValue.serverTimestamp() });
          }
        }

        // Reset the originating store back to no local override.
        const invRef = db.doc(`stores/${r.storeId}/inventory/${r.productId}`);
        const invSnap = await invRef.get();
        if (invSnap.exists) {
          batch.update(invRef, { imageUrl: null, updatedAt: FieldValue.serverTimestamp() });
        }

        batch.update(ref, {
          status: "rejected",
          reviewedByUid: staff.uid,
          reviewedByName: staff.displayName || staff.uid,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();

        return NextResponse.json({ ok: true });
      }

      default:
        return bad(`Unknown op: ${op}`, 400);
    }
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /required/i.test(message)
      ? 400
      : /not allowed|no access|not a staff|not active|token/i.test(message)
        ? 403
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
