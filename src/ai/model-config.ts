/**
 * Central model config for the daily-insight brief.
 *
 * The model id was previously hardcoded in six places, so switching it meant a
 * code change in each. It now lives here once and is overridable at runtime via
 * GENKIT_INSIGHT_MODEL, so the model can be flipped from env WITHOUT a redeploy
 * (the ERP repo learned this the hard way — see its genkit-config.ts).
 *
 * WHY 3.1-flash-lite and not the ERP's 2.5-flash-lite (measured 2026-07-17):
 * this project's Gemini key gets a hard 404 on gemini-2.5-flash-lite — "no
 * longer available to new users". The ERP's key still reaches it only because
 * that project is grandfathered in. 3.1-flash-lite is the cheapest flash-lite
 * this key can actually call.
 *
 * Price per 1M tokens (input/output), for the record:
 *   gemini-2.5-flash      $0.30 / $2.50   ← what this app used to run
 *   gemini-3.1-flash-lite $0.25 / $1.50   ← now
 *   gemini-2.5-flash-lite $0.10 / $0.40   ← cheapest, but 404 for this key
 * Measured on a real Lipa digest: in 570 tok, out ~800 tok, ~3.2s, quality on
 * par with 2.5-flash's prod output.
 */

export const INSIGHT_MODEL = process.env.GENKIT_INSIGHT_MODEL ?? "googleai/gemini-3.1-flash-lite";

/**
 * Hard cap on output tokens for the daily-insight call. Bounds a runaway
 * generation (the ERP repo once saw a single call emit ~29k output tokens).
 *
 * 4,000 — NOT the ERP's 2,500. This is ONE call that emits the WHOLE brief
 * (summary + 4 sections + suggestions ≈ 800–1,800 output tokens), where the ERP
 * caps a single small section. Do not lower it casually:
 *
 * MEASURED TRAP — gemini-2.5-flash under a 2,500 cap FAILS schema validation
 * with "must have required property 'suggestions'". Thinking tokens count
 * against maxOutputTokens, so the cap truncates the response and the LAST field
 * in the schema (suggestions) is the one that gets dropped. Today's prod works
 * only because no cap was set at all. If you set GENKIT_INSIGHT_MODEL back to a
 * thinking-heavy model, raise this or the brief will silently lose suggestions.
 */
export const INSIGHT_MAX_OUTPUT_TOKENS = Number(process.env.GENKIT_INSIGHT_MAX_OUTPUT_TOKENS ?? "4000") || 4000;

/** USD list price per 1M tokens, for cost reporting. Extend when adding a model. */
const MODEL_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "googleai/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "googleai/gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "googleai/gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
};

/** Rough USD→PHP for internal budgeting only — not billing. */
const USD_TO_PHP = Number(process.env.AI_USD_TO_PHP ?? "58");

/** Estimated peso cost of one call. Returns 0 (and warns) for an unpriced model. */
export function estimateCostPesos(model: string, promptTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING_USD_PER_MTOK[model];
  if (!price) {
    console.warn(`[estimateCostPesos] no pricing for '${model}' — reporting ₱0. Add it to MODEL_PRICING_USD_PER_MTOK.`);
    return 0;
  }
  const usd = (promptTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  return Math.round(usd * USD_TO_PHP * 10000) / 10000;
}
