import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function sanitizeValues(input: any[]): any[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v, idx) => ({
      id: String(v?.id || genId()),
      name: String(v?.name || "").trim(),
      priceDelta: Number(v?.priceDelta ?? 0),
      isActive: v?.isActive !== false,
      sortOrder: Number.isFinite(Number(v?.sortOrder)) ? Number(v.sortOrder) : idx,
    }))
    .filter((v) => v.name.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    await requireActiveStaff(db, decoded, ["admin"]);

    const ref = db.doc(`optionGroups/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return bad("Option group not found.", 404);

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim() || (snap.data() as any).name;
    const selectionMode = body?.selectionMode === "multi" ? "multi" : (body?.selectionMode === "single" ? "single" : (snap.data() as any).selectionMode);
    const required = body?.required !== undefined ? !!body.required : (snap.data() as any).required;
    const isActive = body?.isActive !== undefined ? !!body.isActive : (snap.data() as any).isActive;
    const isArchived = body?.isArchived !== undefined ? !!body.isArchived : (snap.data() as any).isArchived === true;
    const minSelections = selectionMode === "multi" && Number.isFinite(Number(body?.minSelections))
      ? Math.max(0, Number(body.minSelections)) : undefined;
    const maxSelections = selectionMode === "multi" && Number.isFinite(Number(body?.maxSelections))
      ? Math.max(1, Number(body.maxSelections)) : undefined;
    const values = body?.values !== undefined ? sanitizeValues(body.values) : (snap.data() as any).values;

    if (!name) return bad("Name is required.", 400);
    if (!Array.isArray(values) || values.length === 0) return bad("At least one value is required.", 400);
    if (minSelections != null && maxSelections != null && minSelections > maxSelections) {
      return bad("minSelections cannot be greater than maxSelections.", 400);
    }

    await ref.update({
      name,
      selectionMode,
      required,
      minSelections: minSelections ?? FieldValue.delete(),
      maxSelections: maxSelections ?? FieldValue.delete(),
      values,
      isActive,
      isArchived,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|admin|staff/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    await requireActiveStaff(db, decoded, ["admin"]);

    const ref = db.doc(`optionGroups/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return bad("Option group not found.", 404);

    // Soft delete (archive). Products that still reference this id will keep
    // doing so, but the picker UIs filter archived groups out.
    await ref.update({
      isArchived: true,
      isActive: false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|admin|staff/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
