import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import {
  LEGACY_COLLECTION,
  summarizeLegacy,
  type LegacyLoyaltyCustomer,
} from "@/lib/server/legacy-loyalty";

export const runtime = "nodejs";

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * The whole parked-legacy-customer list, for the staff claiming panel.
 *
 * Unpaginated on purpose: the collection is a fixed ~106 rows imported from a
 * dead spreadsheet and only ever shrinks in usefulness as rows get claimed.
 * Staff need to scan it by eye against a walk-in, so a client-side filter over
 * the full list beats a server round-trip per keystroke.
 *
 * Cross-branch customer PII, so admin/manager only — matching the fact that
 * `legacyLoyaltyCustomers` is denied to every client in firestore.rules.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return bad("Missing bearer token.", 401);

  let decoded;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    return bad("Invalid token.", 401);
  }
  if (!decoded.uid) return bad("Invalid token.", 401);

  const db = getAdminDb();

  try {
    await requireActiveStaff(db, decoded, ["admin", "manager"]);
  } catch (err: any) {
    return bad(err?.message || "Not active staff.", 403);
  }

  const snap = await db.collection(LEGACY_COLLECTION).get();
  const rows = snap.docs.map((d) => ({ ...(d.data() as LegacyLoyaltyCustomer), id: d.id }));
  rows.sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" }),
  );

  return NextResponse.json({ ok: true, rows, summary: summarizeLegacy(rows) });
}
