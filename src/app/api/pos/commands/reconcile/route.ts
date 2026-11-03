import { NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { requireStaffStoreAccess } from "@/lib/server/staff-access";
import { commandError, readJson } from "@/lib/server/pos-commands/http";
import { PosCommandError } from "@/lib/server/pos-commands/errors";
import { reconcileCommand, type ReconcileAction } from "@/lib/server/pos-commands/reconcile";
import { runPosEffect } from "@/lib/server/pos-commands/effect-runner";

export const runtime = "nodejs";

/**
 * Apply / retry / dismiss an offline POS command (audit B16).
 * Body: { storeId, opId, action?: "apply" | "retry" | "dismiss", note?, command? }.
 * `command` is the till's localStorage copy, used only when the Firestore copy
 * never arrived. The operator is taken from the token stored IN the command
 * (offline rule, docs/audit/pos-financial-commands.md §5), not from this request.
 */
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const storeId = String(body?.storeId || "");
    const opId = String(body?.opId || "");
    const action = (body?.action || "apply") as ReconcileAction;
    if (!["apply", "retry", "dismiss"].includes(action)) throw new PosCommandError("command_invalid", "Invalid action.");
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
      access = await requireStaffStoreAccess(db, decoded, storeId, ["admin", "manager", "cashier"]);
    } catch (e: any) {
      throw new PosCommandError("forbidden", e?.message || "Forbidden.", 403);
    }
    const result = await reconcileCommand(
      db,
      {
        storeId,
        opId,
        action,
        note: body?.note,
        bodyCommand: body?.command,
        caller: { type: "staff", uid: decoded.uid, role: access.role, isPlatformAdmin: access.isPlatformAdmin },
      },
      { runner: runPosEffect },
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return commandError(e);
  }
}
