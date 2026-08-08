import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

/**
 * Clears the forced-password-change flag for the CALLING user.
 *
 * Needed as a server route because firestore.rules makes staff/{uid} writable
 * only by an admin — a user cannot clear their own flag directly.
 *
 * The uid always comes from the verified token, never from the request body, so
 * one user cannot clear another's flag.
 *
 * Honest limitation: this trusts that the client actually completed
 * changePassword() before calling. Firebase itself verified the current
 * password during that reauthentication, so the user already knew it — the only
 * thing a forged call skips is the user's own password change. It is a policy
 * nag, not an authorization boundary, and nothing downstream grants access
 * based on this flag.
 */

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token." }, { status: 401 });
    }
    // checkRevoked: a reset revokes refresh tokens, so a token minted before
    // the reset must not be able to clear the flag it just set.
    const decoded = await getAdminAuth().verifyIdToken(m[1], true);

    const db = getAdminDb();
    const ref = db.doc(`staff/${decoded.uid}`);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Not a staff member." }, { status: 403 });
    }

    await ref.update({
      mustChangePassword: false,
      passwordChangedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
