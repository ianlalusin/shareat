import { NextResponse } from "next/server";
import { authorizeCommand, commandError, readJson } from "@/lib/server/pos-commands/http";
import { parseReceiptEditInput, runReceiptEdit } from "@/lib/server/pos-commands/receipt-commands";
import { processEffects } from "@/lib/server/pos-commands/effects";
import { runPosEffect } from "@/lib/server/pos-commands/effect-runner";
import { applyReceiptEvent } from "@/lib/server/analytics/receiptEventApplier";

export const runtime = "nodejs";

/**
 * Receipt correction (audit B01). The revision snapshot is taken from the
 * server copy, totals are recomputed, tenders are settled to the new total.
 */
export async function POST(req: Request) {
  try {
    const input = parseReceiptEditInput(await readJson(req));
    const { db, operator } = await authorizeCommand(req, input.storeId, ["admin", "manager"]);
    const out = await runReceiptEdit(db, input, operator, (storeId, receiptId) =>
      applyReceiptEvent(db, storeId, receiptId, "payment", { source: "endpoint" }),
    );
    const effects = out.effectIds.length ? await processEffects(db, input.storeId, out.effectIds, runPosEffect) : null;
    return NextResponse.json({ ok: true, ...out, effects });
  } catch (e) {
    return commandError(e);
  }
}
