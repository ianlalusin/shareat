import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireActiveStaff } from "@/lib/server/active-staff-check";
import { generateTempPassword } from "@/lib/server/temp-password";

/**
 * Admin-issued password reset.
 *
 * Sets a random temporary password on the target account and flags the staff
 * doc so the next sign-in is forced through /change-password. The temporary
 * password is returned exactly once, in this response, for the admin to hand to
 * the user out of band — it is never persisted and never logged.
 *
 * Runs on the Admin SDK because setting another user's password is not
 * something the client SDK can do, and because staff/{uid} is admin-write-only
 * in firestore.rules.
 */

export const runtime = "nodejs";

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
    if (!staff.isPlatformAdmin) {
      return bad("Not allowed: only platform admins can reset passwords.", 403);
    }

    const body = await req.json().catch(() => ({}));
    const uid = String(body?.uid || "").trim();
    if (!uid) return bad("uid is required.", 400);

    // Resetting your own password here would sign you out mid-session (the
    // token revoke below) and strand you on the forced-change screen. Use
    // Account -> Change Password instead.
    if (uid === staff.uid) {
      return bad("Use Account → Change Password to change your own password.", 400);
    }

    const targetSnap = await db.doc(`staff/${uid}`).get();
    if (!targetSnap.exists) return bad("That user has no staff profile.", 404);
    const target = targetSnap.data() as any;

    let targetAuth;
    try {
      targetAuth = await getAdminAuth().getUser(uid);
    } catch {
      return bad("That user does not exist in Firebase Auth.", 404);
    }

    // A Google-only account has no password to reset — setting one would
    // silently add a second sign-in method the user does not expect.
    const hasPasswordProvider = targetAuth.providerData.some((p) => p.providerId === "password");
    if (!hasPasswordProvider) {
      return bad(
        "That account signs in with Google, so it has no password to reset. Ask them to use Account → Change Password to add one.",
        400
      );
    }

    const tempPassword = generateTempPassword();

    await getAdminAuth().updateUser(uid, { password: tempPassword });

    // Kick every existing session. Without this, a reset prompted by a
    // suspected compromise would leave the intruder signed in — changing the
    // password alone does not invalidate issued refresh tokens.
    await getAdminAuth().revokeRefreshTokens(uid);

    await db.doc(`staff/${uid}`).update({
      mustChangePassword: true,
      passwordResetAt: FieldValue.serverTimestamp(),
      passwordResetByUid: staff.uid,
      passwordResetByName: staff.displayName || staff.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // tempPassword is returned to the caller only. Do not add it to any log
    // line, error message, or analytics event.
    return NextResponse.json({
      ok: true,
      tempPassword,
      user: { uid, name: target?.name ?? null, email: targetAuth.email ?? null },
    });
  } catch (e: any) {
    const message = e?.message ?? "Unknown error";
    const status = /required/i.test(message)
      ? 400
      : /not allowed|no access|not a staff|not active/i.test(message)
        ? 403
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
