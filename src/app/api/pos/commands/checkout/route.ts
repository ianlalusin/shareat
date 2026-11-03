import { NextResponse } from "next/server";
import { authorizeCommand, commandError, readJson } from "@/lib/server/pos-commands/http";
import { parseCheckoutInput, runCheckout } from "@/lib/server/pos-commands/checkout";
import { processEffects } from "@/lib/server/pos-commands/effects";
import { runPosEffect } from "@/lib/server/pos-commands/effect-runner";

export const runtime = "nodejs";

/**
 * Authoritative checkout (audit B01/B03). Body: { storeId, sessionId, opId,
 * payments[], expectedTotalCents, billingRevision }. Totals, receipt number and
 * operator are derived on the server; gateway payments are verified and
 * consumed in the same transaction. Retrying with the same opId returns the
 * original outcome. See docs/audit/pos-financial-commands.md §3.1.
 */
export async function POST(req: Request) {
  try {
    const input = parseCheckoutInput(await readJson(req));
    const { db, operator } = await authorizeCommand(req, input.storeId, ["admin", "manager", "cashier"]);
    const out = await runCheckout(db, input, operator);
    // Effects were committed with the receipt; run them now, best effort (the
    // cron sweep retries anything left pending).
    const effects = out.effectIds.length ? await processEffects(db, input.storeId, out.effectIds, runPosEffect) : null;
    return NextResponse.json({ ok: true, ...out, effects });
  } catch (e) {
    return commandError(e);
  }
}
