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

async function revocationBoundarySeconds(uid: string, existing: unknown): Promise<number> {
  let firebaseSec = 0;
  try {
    const after = Date.parse((await getAdminAuth().getUser(uid)).tokensValidAfterTime ?? "");
    if (Number.isFinite(after)) firebaseSec = Math.floor(after / 1000);
  } catch {
    // Fall back to the server clock below.
  }
  const prior = typeof existing === "number" && Number.isFinite(existing) ? existing : 0;
  return Math.max(Math.floor(Date.now() / 1000), firebaseSec, prior);
}

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1], true);

    const db = getAdminDb();
    const staff = await requireActiveStaff(db, decoded, ["admin"]);

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

    // Resetting another admin's password is a platform-admin (custom-claim)
    // action, not a regular admin-role one. requireActiveStaff(["admin"])
    // above already lets in anyone with staffData().role === "admin", and
    // that role trivially satisfies isPlatformAdmin too (it's defined as
    // decoded.platformAdmin===true || role==="admin"), so checking
    // staff.isPlatformAdmin here would always be true and never actually
    // restrict anything — checking decoded.platformAdmin directly is what
    // makes this a real hierarchy check. Without it, any compromised or
    // malicious admin-role staff account could take over every other admin
    // account (this also revokes the target's sessions below).
    if (String(target?.role || "") === "admin" && decoded.platformAdmin !== true) {
      return bad("Only a platform admin can reset another admin's password.", 403);
    }

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

    // Audit B22: revocation only stops refresh tokens and checkRevoked API
    // calls. Firestore/Storage rules cannot see it, so an ID token issued before
    // this reset kept working against direct reads/writes for up to an hour.
    // tokensValidAfter (epoch SECONDS, the unit of the token's auth_time) is the
    // boundary the rules' tokenNotRevoked() compares against. Taken after the
    // revoke, and never below Firebase's own tokensValidAfterTime, so server
    // clock skew cannot leave a pre-reset token inside the fence. Never lowered:
    // an earlier reset's later boundary stays. auth_time is set at sign-in, so
    // the user must sign in again (with the temporary password) to pass it.
    const tokensValidAfter = await revocationBoundarySeconds(uid, target?.tokensValidAfter);

    await db.doc(`staff/${uid}`).update({
      tokensValidAfter,
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
