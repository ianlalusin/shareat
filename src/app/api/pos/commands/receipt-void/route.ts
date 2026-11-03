import { NextResponse } from "next/server";
import { authorizeCommand, commandError, readJson } from "@/lib/server/pos-commands/http";
import { parseReceiptVoidInput, runReceiptVoid } from "@/lib/server/pos-commands/receipt-commands";
import { processEffects } from "@/lib/server/pos-commands/effects";
import { runPosEffect } from "@/lib/server/pos-commands/effect-runner";

export const runtime = "nodejs";

/**
 * Void a final receipt (audit B01). Body: { storeId, receiptId, reason,
 * voidCashDisposition?, voidCashRefunded? (partial only) }. Cash paid and
 * retained are derived from the receipt on the server.
 */
export async function POST(req: Request) {
  try {
    const input = parseReceiptVoidInput(await readJson(req));
    const { db, operator } = await authorizeCommand(req, input.storeId, ["admin", "manager"]);
    const out = await runReceiptVoid(db, input, operator);
    const effects = out.effectIds.length ? await processEffects(db, input.storeId, out.effectIds, runPosEffect) : null;
    return NextResponse.json({ ok: true, ...out, effects });
  } catch (e) {
    return commandError(e);
  }
}
