import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import {
  hashPasscodeScrypt,
  isValidPasscode,
  verifyProfilePasscodeAtomic,
} from "@/lib/server/server-profile-secrets";

/**
 * Local (device) server profiles.
 *
 * Every write goes through here, and passcode verification is server-side.
 * Previously the roster — including an unsalted SHA-256 of a 6-digit passcode —
 * was readable by any active staff member of the store, and the comparison
 * happened in the browser. That let anyone crack a colleague's passcode offline
 * in under a second, or simply overwrite their passcodeHash, and then act on a
 * shared tablet under their name. Local profiles are what the activity log uses
 * to attribute voids, discounts and cash handling, so that undermined the audit
 * trail rather than just a sign-in.
 */

export const runtime = "nodejs";

const ALL_ROLES = ["admin", "manager", "cashier", "kitchen", "server"] as const;
const MANAGER_ROLES = ["admin", "manager"] as const;

// Lockout limits live with the atomic verifier in server-profile-secrets.ts.

function bad(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function secretRef(db: Firestore, storeId: string, profileId: string) {
  return db.doc(`stores/${storeId}/serverProfileSecrets/${profileId}`);
}
function profileRef(db: Firestore, storeId: string, profileId: string) {
  return db.doc(`stores/${storeId}/serverProfiles/${profileId}`);
}

export async function POST(req: Request) {
  try {
    const authz = req.headers.get("authorization") || "";
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return bad("Missing Authorization Bearer token.", 401);
    const decoded = await getAdminAuth().verifyIdToken(m[1], true);

    const db = getAdminDb();
    const body = await req.json().catch(() => ({}));
    const op = String(body?.op || "");
    const storeId = String(body?.storeId || "").trim();
    if (!storeId) return bad("storeId is required.", 400);

    switch (op) {
      // ---------------------------------------------------------------------
      case "verify": {
        await requireStaffStoreAccess(db, decoded, storeId, [...ALL_ROLES]);

        const profileId = String(body?.profileId || "").trim();
        const passcode = String(body?.passcode ?? "");
        if (!profileId) return bad("profileId is required.", 400);

        // Lockout check, passcode check and attempt counting happen in one
        // transaction so parallel guesses cannot share a stale failure count
        // (audit B21).
        const outcome = await verifyProfilePasscodeAtomic(db, storeId, profileId, passcode);
        switch (outcome.kind) {
          case "not-found":
            return bad("That local user no longer exists.", 404);
          case "locked":
            return bad(`Too many wrong passcodes. Try again in ${outcome.minutes} minute(s).`, 429);
          case "no-secret":
            return bad("That local user has no passcode set. Ask a manager to reset it.", 409);
          case "wrong":
            return bad("Incorrect passcode.", 401);
          case "ok":
            return NextResponse.json({ ok: true, profile: { id: profileId, name: outcome.name } });
        }
      }

      // ---------------------------------------------------------------------
      case "create": {
        // Any active staff member of the store may add a local user — this
        // matches the existing self-service flow on the switcher.
        const staff = await requireStaffStoreAccess(db, decoded, storeId, [...ALL_ROLES]);

        const name = String(body?.name || "").trim();
        const passcode = String(body?.passcode ?? "");
        if (name.length < 2) return bad("Name must be at least 2 characters.", 400);
        if (!isValidPasscode(passcode)) return bad("Passcode must be 6 digits.", 400);

        const existing = await db.collection(`stores/${storeId}/serverProfiles`).get();
        const clash = existing.docs.some(
          (d) => String((d.data() as any)?.name ?? "").trim().toLowerCase() === name.toLowerCase()
        );
        if (clash) return bad(`There is already a local user called "${name}".`, 409);

        const ref = db.collection(`stores/${storeId}/serverProfiles`).doc();
        const secret = hashPasscodeScrypt(passcode);

        const batch = db.batch();
        batch.set(ref, {
          id: ref.id,
          name,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdByUid: staff.uid,
        });
        batch.set(secretRef(db, storeId, ref.id), {
          profileId: ref.id,
          ...secret,
          failedAttempts: 0,
          lockedUntilMs: 0,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();

        return NextResponse.json({ ok: true, profile: { id: ref.id, name } });
      }

      // ---------------------------------------------------------------------
      case "reset-passcode": {
        const staff = await requireStaffStoreAccess(db, decoded, storeId, [...MANAGER_ROLES]);

        const profileId = String(body?.profileId || "").trim();
        const passcode = String(body?.passcode ?? "");
        if (!profileId) return bad("profileId is required.", 400);
        if (!isValidPasscode(passcode)) return bad("Passcode must be 6 digits.", 400);

        const pSnap = await profileRef(db, storeId, profileId).get();
        if (!pSnap.exists) return bad("That local user no longer exists.", 404);

        const secret = hashPasscodeScrypt(passcode);
        const batch = db.batch();
        batch.set(
          secretRef(db, storeId, profileId),
          {
            profileId,
            ...secret,
            failedAttempts: 0,
            lockedUntilMs: 0,
            resetByUid: staff.uid,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        batch.update(profileRef(db, storeId, profileId), {
          passcodeHash: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await batch.commit();

        return NextResponse.json({ ok: true });
      }

      // ---------------------------------------------------------------------
      case "delete": {
        await requireStaffStoreAccess(db, decoded, storeId, [...MANAGER_ROLES]);

        const profileId = String(body?.profileId || "").trim();
        if (!profileId) return bad("profileId is required.", 400);

        const batch = db.batch();
        batch.delete(profileRef(db, storeId, profileId));
        batch.delete(secretRef(db, storeId, profileId));
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
      : /not allowed|no access|not a staff|not active/i.test(message)
        ? 403
        : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
