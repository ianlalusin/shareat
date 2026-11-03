import type { Firestore } from "firebase-admin/firestore";
import { verifyProfileSession } from "@/lib/server/server-profile-session";
import { PosCommandError } from "@/lib/server/pos-commands/errors";

/**
 * Operator attribution for financial commands (audit P1 / F02).
 *
 * The operator written on receipts, voids and refunds comes from the signed
 * local-profile session token (header `x-pos-operator-session`), never from a
 * client-supplied name or id. See docs/audit/pos-financial-commands.md §5.
 */
export const OPERATOR_HEADER = "x-pos-operator-session";

/** Clock skew allowed on an offline command's recorded time. */
export const OFFLINE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type Operator = {
  uid: string; // authenticated Firebase account (audit integrity)
  username: string; // display name written as the cashier / actor
  profileId: string | null; // local profile when verified
  verified: boolean; // true only for a verified local-profile session
};

export type OperatorContext = {
  uid: string;
  role: string;
  isPlatformAdmin: boolean;
  storeId: string;
  token: string | null | undefined;
  /** Offline command: verify the token as of this time (ms) instead of now. */
  commandAtMs?: number;
  now?: number;
  /** Test seam; production uses the configured signing key. */
  key?: Buffer | null;
};

async function accountName(db: Firestore, uid: string): Promise<string> {
  try {
    const snap = await db.doc(`staff/${uid}`).get();
    const d = (snap.exists ? snap.data() : null) as any;
    const name = String(d?.name || d?.displayName || "").trim() || (d?.email ? String(d.email).split("@")[0] : "");
    return name || uid.slice(0, 6);
  } catch {
    return uid.slice(0, 6);
  }
}

export async function resolveOperator(db: Firestore, ctx: OperatorContext): Promise<Operator> {
  const now = ctx.now ?? Date.now();
  const elevated = ctx.isPlatformAdmin || ctx.role === "admin" || ctx.role === "manager";
  const accountFallback = async (): Promise<Operator> => ({
    uid: ctx.uid,
    username: await accountName(db, ctx.uid),
    profileId: null,
    verified: false,
  });

  let verifyAt = now;
  if (ctx.commandAtMs !== undefined) {
    if (!Number.isFinite(ctx.commandAtMs) || ctx.commandAtMs > now + OFFLINE_CLOCK_SKEW_MS) {
      throw new PosCommandError("operator_session_invalid", "Offline command time is invalid.", 401);
    }
    verifyAt = ctx.commandAtMs;
  }

  const token = typeof ctx.token === "string" && ctx.token.trim() ? ctx.token.trim() : null;
  const opts = ctx.key === undefined ? { now: verifyAt } : { now: verifyAt, key: ctx.key };
  const check = verifyProfileSession(token ?? "", { uid: ctx.uid, storeId: ctx.storeId }, opts);

  if (check.ok) {
    // Offline rule: the command must have been recorded while the token was
    // valid (iat <= command time < exp). verifyProfileSession already checked
    // exp against verifyAt.
    if (ctx.commandAtMs !== undefined && check.payload.iat > ctx.commandAtMs) {
      throw new PosCommandError("operator_session_invalid", "Local user session was issued after this command.", 401);
    }
    const snap = await db.doc(`stores/${ctx.storeId}/serverProfiles/${check.payload.pid}`).get();
    if (!snap.exists) {
      throw new PosCommandError("operator_session_invalid", "This local user no longer exists. Sign in again.", 401);
    }
    const name = String((snap.data() as any)?.name ?? "").trim();
    return { uid: ctx.uid, username: name || check.payload.pid.slice(0, 6), profileId: check.payload.pid, verified: true };
  }

  // The server has no signing key, so no device was ever given a token.
  if (check.reason === "no-key") return accountFallback();
  // Admins and managers bypass the local-profile gate in the UI.
  if (elevated) return accountFallback();
  throw new PosCommandError(
    "operator_session_required",
    token ? "Local user session is not valid. Sign in to the till again." : "Sign in as a local user on this till first.",
    401,
  );
}
