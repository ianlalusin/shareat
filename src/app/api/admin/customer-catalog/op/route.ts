import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { rebuildStoreCatalogCache } from "@/lib/server/customer-catalog";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

type Op =
  | "create"
  | "update"
  | "archive"
  | "revive"
  | "toggle-global-avail"
  | "set-link"
  | "store-toggle-avail"
  | "store-override"
  | "rebuild-cache"
  | "create-category";

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

    // Helper to enforce store access for any store-scoped op.
    function checkStoreAccess() {
      if (!storeId) throw new Error("storeId required.");
      if (!staff.isPlatformAdmin && !staff.assignedStoreIds.includes(storeId)) {
        throw new Error("No access to this store.");
      }
    }

    // Helper to write the same per-store cache patch we apply after global edits
    // (so changes show up without waiting for the full rebuild).
    async function rebuildIfStore() {
      if (storeId) await rebuildStoreCatalogCache(db, storeId);
    }

    switch (op) {
      case "create": {
        const name = String(body?.name || "").trim();
        const category = String(body?.category || "").trim();
        const price = Number(body?.price ?? 0);
        const imageUrl = body?.imageUrl ?? null;
        if (!name) return bad("name is required.", 400);
        const ref = db.collection("catalogItems").doc();
        await ref.set({
          name,
          category,
          price,
          imageUrl,
          isAvailable: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await rebuildIfStore();
        return NextResponse.json({ ok: true, id: ref.id });
      }

      case "update": {
        const id = String(body?.id || "");
        if (!id) return bad("id required.", 400);
        const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
        if (body?.name !== undefined) updates.name = String(body.name).trim();
        if (body?.category !== undefined) updates.category = String(body.category).trim();
        if (body?.price !== undefined) updates.price = Number(body.price);
        if (body?.imageUrl !== undefined) updates.imageUrl = body.imageUrl;
        await db.doc(`catalogItems/${id}`).update(updates);
        await rebuildIfStore();
        return NextResponse.json({ ok: true });
      }

      case "archive": {
        const id = String(body?.id || "");
        if (!id) return bad("id required.", 400);
        await db.doc(`catalogItems/${id}`).update({
          isArchived: true,
          isAvailable: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await rebuildIfStore();
        return NextResponse.json({ ok: true });
      }

      case "revive": {
        const id = String(body?.id || "");
        if (!id) return bad("id required.", 400);
        await db.doc(`catalogItems/${id}`).update({
          isArchived: false,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await rebuildIfStore();
        return NextResponse.json({ ok: true });
      }

      case "toggle-global-avail": {
        const id = String(body?.id || "");
        const nextValue = !!body?.isAvailable;
        if (!id) return bad("id required.", 400);
        await db.doc(`catalogItems/${id}`).update({
          isAvailable: nextValue,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await rebuildIfStore();
        return NextResponse.json({ ok: true });
      }

      case "set-link": {
        const id = String(body?.id || "");
        if (!id) return bad("id required.", 400);
        const linkedPosProductId = body?.linkedPosProductId ? String(body.linkedPosProductId) : null;
        const linkedPosProductName = body?.linkedPosProductName ? String(body.linkedPosProductName) : null;
        await db.doc(`catalogItems/${id}`).update({
          linkedPosProductId,
          linkedPosProductName,
          updatedAt: FieldValue.serverTimestamp(),
        });
        await rebuildIfStore();
        return NextResponse.json({ ok: true });
      }

      case "store-toggle-avail": {
        checkStoreAccess();
        const id = String(body?.id || "");
        if (!id) return bad("id required.", 400);
        const ref = db.doc(`stores/${storeId}/catalogCache/main`);
        const snap = await ref.get();
        const data = snap.exists ? (snap.data() as any) : null;
        const arr: any[] = Array.isArray(data?.items) ? data.items : [];
        const next = arr.map((x) => {
          if (String(x?.id || "") !== id) return x;
          return {
            ...x,
            isAvailable: x.isAvailable === false ? true : false,
            storeUpdatedAtMs: Date.now(),
          };
        });
        await ref.set({ items: next, updatedAtMs: Date.now() }, { merge: true });
        return NextResponse.json({ ok: true });
      }

      case "store-override": {
        checkStoreAccess();
        const id = String(body?.id || "");
        if (!id) return bad("id required.", 400);
        const ref = db.doc(`stores/${storeId}/catalogCache/main`);
        const snap = await ref.get();
        const data = snap.exists ? (snap.data() as any) : null;
        const arr: any[] = Array.isArray(data?.items) ? data.items : [];
        const next = arr.map((x) => {
          if (String(x?.id || "") !== id) return x;
          const patched = { ...x, storeUpdatedAtMs: Date.now() };
          if (body?.name !== undefined) patched.name = String(body.name).trim();
          if (body?.category !== undefined) patched.category = String(body.category).trim();
          if (body?.price !== undefined) patched.price = Number(body.price);
          if (body?.imageUrl !== undefined) patched.imageUrl = body.imageUrl;
          return patched;
        });
        await ref.set({ items: next, updatedAtMs: Date.now() }, { merge: true });
        return NextResponse.json({ ok: true });
      }

      case "rebuild-cache": {
        checkStoreAccess();
        const result = await rebuildStoreCatalogCache(db, storeId!);
        return NextResponse.json({ ok: true, ...result });
      }

      case "create-category": {
        const name = String(body?.name || "").trim();
        if (!name) return bad("name required.", 400);
        const ref = db.collection("categories").doc();
        await ref.set({
          name,
          isActive: true,
          sortOrder: Number(body?.sortOrder ?? 0),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return NextResponse.json({ ok: true, id: ref.id });
      }

      default:
        return bad(`Unknown op: ${op}`, 400);
    }
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /required|already exists/i.test(message) ? 400
      : /not allowed|no access|not a staff/i.test(message) ? 403
      : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
