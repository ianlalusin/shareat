import { NextResponse } from "next/server";
import { authorizeCommand, commandError, readJson } from "@/lib/server/pos-commands/http";
import { parseVoidSessionInput, runVoidSession } from "@/lib/server/pos-commands/void-session";
import { processEffects } from "@/lib/server/pos-commands/effects";
import { runPosEffect } from "@/lib/server/pos-commands/effect-runner";

export const runtime = "nodejs";

/** Void an open session (audit B01/B17). Body: { storeId, sessionId, opId, reason }. */
export async function POST(req: Request) {
  try {
    const input = parseVoidSessionInput(await readJson(req));
    const { db, operator } = await authorizeCommand(req, input.storeId, ["admin", "manager", "cashier"]);
    const out = await runVoidSession(db, input, operator);
    const effects = out.effectIds.length ? await processEffects(db, input.storeId, out.effectIds, runPosEffect) : null;
    return NextResponse.json({ ok: true, ...out, effects });
  } catch (e) {
    return commandError(e);
  }
}
