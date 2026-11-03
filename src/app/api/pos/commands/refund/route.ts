import { NextResponse } from "next/server";
import { authorizeCommand, commandError, readJson } from "@/lib/server/pos-commands/http";
import { parseRefundInput, runRefund } from "@/lib/server/pos-commands/receipt-commands";
import { processEffects } from "@/lib/server/pos-commands/effects";
import { runPosEffect } from "@/lib/server/pos-commands/effect-runner";

export const runtime = "nodejs";

/**
 * Refund receipt (audit B01). Body: { storeId, parentReceiptId, requestId,
 * refundQtys, reason }. `requestId` is the refund receipt id (idempotent).
 */
export async function POST(req: Request) {
  try {
    const input = parseRefundInput(await readJson(req));
    const { db, operator } = await authorizeCommand(req, input.storeId, ["admin", "manager"]);
    const out = await runRefund(db, input, operator);
    const effects = out.effectIds.length ? await processEffects(db, input.storeId, out.effectIds, runPosEffect) : null;
    return NextResponse.json({ ok: true, ...out, effects });
  } catch (e) {
    return commandError(e);
  }
}
