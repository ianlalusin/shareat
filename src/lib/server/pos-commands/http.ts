import "server-only";
import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { PosCommandError } from "@/lib/server/pos-commands/errors";
import { OPERATOR_HEADER, resolveOperator, type Operator } from "@/lib/server/pos-commands/operator";

type Role = "admin" | "manager" | "cashier" | "kitchen" | "server";

export type CommandAuth = {
  db: Firestore;
  decoded: DecodedIdToken;
  role: string;
  isPlatformAdmin: boolean;
  operator: Operator;
};

/**
 * Shared front door for /api/pos/commands/*: revocation-checked ID token,
 * active staff with access to the store and one of `roles`, and the operator
 * from the signed local-profile session header.
 */
export async function authorizeCommand(req: Request, storeId: string, roles: Role[]): Promise<CommandAuth> {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match) throw new PosCommandError("unauthenticated", "Missing bearer token.", 401);
  let decoded: DecodedIdToken;
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1], true);
  } catch {
    throw new PosCommandError("unauthenticated", "Invalid token.", 401);
  }
  const db = getAdminDb();
  let access;
  try {
    access = await requireStaffStoreAccess(db, decoded, storeId, roles);
  } catch (e: any) {
    throw new PosCommandError("forbidden", e?.message || "Forbidden.", 403);
  }
  const operator = await resolveOperator(db, {
    uid: decoded.uid,
    role: access.role,
    isPlatformAdmin: access.isPlatformAdmin,
    storeId,
    token: req.headers.get(OPERATOR_HEADER),
  });
  return { db, decoded, role: access.role, isPlatformAdmin: access.isPlatformAdmin, operator };
}

export async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new PosCommandError("command_invalid", "Invalid JSON body.", 400);
  }
}

export function commandError(e: unknown) {
  if (e instanceof PosCommandError) {
    return NextResponse.json({ ok: false, code: e.code, error: e.message }, { status: e.status });
  }
  console.error("[pos-commands] unexpected failure:", e);
  return NextResponse.json({ ok: false, code: "internal", error: (e as any)?.message || "Request failed." }, { status: 500 });
}
