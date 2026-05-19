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

function validate(body: any): { ok: true; data: any } | { ok: false; error: string } {
  const name = String(body?.name || "").trim();
  const selectionMode = body?.selectionMode === "multi" ? "multi" : "single";
  const required = !!body?.required;
  const minSelections = selectionMode === "multi" && Number.isFinite(Number(body?.minSelections))
    ? Math.max(0, Number(body.minSelections)) : undefined;
  const maxSelections = selectionMode === "multi" && Number.isFinite(Number(body?.maxSelections))
    ? Math.max(1, Number(body.maxSelections)) : undefined;
  const values = sanitizeValues(body?.values);
  const isActive = body?.isActive !== false;

  if (!name) return { ok: false, error: "Name is required." };
  if (values.length === 0) return { ok: false, error: "At least one value is required." };
  if (minSelections != null && maxSelections != null && minSelections > maxSelections) {
    return { ok: false, error: "minSelections cannot be greater than maxSelections." };
  }
  if (selectionMode === "single" && values.filter((v) => v.isActive).length === 0) {
    return { ok: false, error: "Single-select groups need at least one active value." };
  }
  return {
    ok: true,
    data: { name, selectionMode, required, minSelections, maxSelections, values, isActive },
  };
}

export async function GET(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    await requireActiveStaff(db, decoded, ["admin", "manager"]);

    const url = new URL(req.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";

    const snap = await db.collection("optionGroups").orderBy("name", "asc").get();
    const groups = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((g) => (includeArchived ? true : g.isArchived !== true));

    return NextResponse.json({ ok: true, groups });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|admin|staff/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    await requireActiveStaff(db, decoded, ["admin"]);

    const body = await req.json().catch(() => ({}));
    const v = validate(body);
    if (!v.ok) return bad(v.error, 400);

    const ref = db.collection("optionGroups").doc();
    await ref.set({
      id: ref.id,
      ...v.data,
      isArchived: false,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|admin|staff/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
