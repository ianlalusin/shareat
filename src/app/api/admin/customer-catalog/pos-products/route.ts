import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

export const runtime = "nodejs";

const MAX_RESULTS = 50;

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
    await requireActiveStaff(db, decoded, ["admin", "manager"]);

    const url = new URL(req.url);
    const qRaw = String(url.searchParams.get("q") || "").trim().toLowerCase();

    const snap = await db.collection("products").orderBy("name", "asc").get();
    const all = snap.docs
      .map((d) => {
        const x = d.data() as any;
        const name = String(x?.name ?? "");
        // Prefer the new variantLabel when present, fall back to the legacy
        // single-variant `variant` field. Matches getEffectiveVariantLabel().
        const variant = x?.variantLabel || x?.variant || "";
        const displayName = variant ? `${name} (${variant})` : name;
        return {
          id: d.id,
          name,
          variant: variant ? String(variant) : "",
          displayName,
          category: String(x?.category ?? ""),
          subCategory: String(x?.subCategory ?? ""),
          isActive: x?.isActive !== false,
        };
      })
      .filter((p) => p.isActive);

    const filtered = qRaw
      ? all.filter((p) => p.displayName.toLowerCase().includes(qRaw))
      : all;

    return NextResponse.json({
      ok: true,
      products: filtered.slice(0, MAX_RESULTS).map(({ id, name, variant, displayName, category, subCategory }) => ({
        id, name, variant, displayName, category, subCategory,
      })),
      totalMatched: filtered.length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
