import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";

export const runtime = "nodejs";

type MergeMode = "create" | "promote";
type VariantInput = { productId: string; variantLabel: string };

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1]);

    const db = getAdminDb();
    const staff = await requireActiveStaff(db, decoded, ["admin"]);
    if (!staff.isPlatformAdmin && staff.role !== "admin") {
      return bad("Only platform admins can merge products.", 403);
    }

    const body = (await req.json().catch(() => ({}))) as {
      mode?: MergeMode;
      parentName?: string;
      parentProductId?: string | null;
      parentSubCategory?: string | null;
      variants?: VariantInput[];
    };

    const mode = body.mode;
    const parentName = String(body.parentName || "").trim();
    const parentProductId = body.parentProductId ? String(body.parentProductId) : null;
    const overrideSubCategory = body.parentSubCategory ? String(body.parentSubCategory).trim() : null;
    const variants = Array.isArray(body.variants) ? body.variants : [];

    if (mode !== "create" && mode !== "promote") return bad("Invalid mode.", 400);
    if (!parentName) return bad("Family name is required.", 400);
    if (variants.length < 2) return bad("At least 2 products are required to form a family.", 400);

    const ids = variants.map((v) => String(v?.productId || "")).filter(Boolean);
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length !== ids.length) return bad("Duplicate product IDs in selection.", 400);
    if (uniqueIds.length < 2) return bad("At least 2 distinct products are required.", 400);

    for (const v of variants) {
      if (!v.productId || !String(v.variantLabel || "").trim()) {
        return bad("Each selected product needs a variant label.", 400);
      }
    }

    if (mode === "promote") {
      if (!parentProductId) return bad("parentProductId is required for promote mode.", 400);
      if (!uniqueIds.includes(parentProductId)) {
        return bad("parentProductId must be one of the selected products.", 400);
      }
    }

    // Load every referenced product doc atomically so we can validate before writing.
    const refs = uniqueIds.map((id) => db.doc(`products/${id}`));
    const snaps = await db.getAll(...refs);
    const docsById = new Map<string, any>();
    for (const s of snaps) {
      if (!s.exists) return bad(`Product ${s.id} not found.`, 404);
      docsById.set(s.id, s.data());
    }

    // Reject any doc that is already a group (don't merge two umbrellas in this iteration).
    for (const id of uniqueIds) {
      const d = docsById.get(id)!;
      if (d?.kind === "group") {
        return bad(`Cannot merge an existing family: ${d?.name ?? id} is already a group parent.`, 400);
      }
    }

    // Reject variants that belong to a DIFFERENT existing group (don't orphan them).
    for (const id of uniqueIds) {
      const d = docsById.get(id)!;
      if (d?.kind === "variant" && d?.groupId && d.groupId !== parentProductId) {
        return bad(`${d?.name ?? id} is already a variant of another family. Unmerge it first.`, 400);
      }
    }

    // Infer subCategory / category from the most common across selected, used for the new parent doc.
    function mostCommon<T extends string | undefined>(values: T[]): T | undefined {
      const counts = new Map<T, number>();
      for (const v of values) if (v != null) counts.set(v, (counts.get(v) || 0) + 1);
      let best: T | undefined;
      let bestCount = 0;
      for (const [v, c] of counts) {
        if (c > bestCount) { best = v; bestCount = c; }
      }
      return best;
    }

    const selectedDocs = uniqueIds.map((id) => docsById.get(id));
    const inferredSubCategory =
      overrideSubCategory || mostCommon(selectedDocs.map((d) => String(d?.subCategory || ""))) || "Uncategorized";
    const inferredCategory = mostCommon(selectedDocs.map((d) => String(d?.category || ""))) || "Add-on";
    const inferredUom = mostCommon(selectedDocs.map((d) => String(d?.uom || ""))) || "pcs";
    const inferredImage = selectedDocs.find((d) => d?.imageUrl)?.imageUrl ?? null;

    const batch = db.batch();
    const nowTs = FieldValue.serverTimestamp();

    let parentId: string;
    if (mode === "create") {
      const newParentRef = db.collection("products").doc();
      parentId = newParentRef.id;
      batch.set(newParentRef, {
        id: newParentRef.id,
        name: parentName,
        variant: "",
        variantLabel: null,
        description: "",
        kind: "group",
        groupId: null,
        groupName: null,
        isSku: false,
        category: inferredCategory,
        subCategory: inferredSubCategory,
        uom: inferredUom,
        barcode: "",
        imageUrl: inferredImage,
        isActive: true,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
    } else {
      parentId = parentProductId!;
      const parentRef = db.doc(`products/${parentId}`);
      batch.update(parentRef, {
        name: parentName,
        variant: "",
        variantLabel: null,
        kind: "group",
        groupId: null,
        groupName: null,
        isSku: false,
        ...(overrideSubCategory ? { subCategory: inferredSubCategory } : {}),
        updatedAt: nowTs,
      });
    }

    // Update each selected (other than the promoted parent, if any) to be a variant.
    for (const v of variants) {
      if (mode === "promote" && v.productId === parentId) continue;
      const ref = db.doc(`products/${v.productId}`);
      batch.update(ref, {
        kind: "variant",
        groupId: parentId,
        groupName: parentName,
        name: parentName,
        variant: "",
        variantLabel: v.variantLabel.trim(),
        isSku: true,
        updatedAt: nowTs,
      });
    }

    await batch.commit();

    const variantCount = mode === "promote" ? variants.length - 1 : variants.length;
    return NextResponse.json({ ok: true, parentId, variantCount });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /not allowed|admin|staff/i.test(message) ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
