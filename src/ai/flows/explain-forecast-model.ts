import "server-only";
import { ai } from "@/ai/genkit";
import { z } from "genkit";
import { explainWithClaude, isClaudeConfigured } from "@/ai/claude";
import type { ForecastModel } from "@/lib/forecast/model";

const ExplanationSchema = z.object({ summary: z.string(), flags: z.array(z.string()) });
export type ModelExplanation = { summary: string; flags: string[]; provider: "claude" | "gemini" };

export function buildExplainPrompt(model: ForecastModel): string {
  const { reasoning: _previous, ...facts } = model;
  return `You review the learned sales-forecast model of one restaurant branch in the Philippines. Amounts are pesos (₱).

Fields:
- weekday["0".."6"] (Sun..Sat): base = typical sales, mad = typical miss ratio (stability), samples = days learned.
- rain: effect of afternoon/evening rain. liftPct = applied effect in %, samples = rainy days learned, evidence = recent days (expected vs actual).
- payday["<offset>_<class>"]: offset -1 = day before payday, 0 = payday, 1/2 = days after; class "fri" = payday fell on a Friday (natural, or moved from a weekend — see evidence notes "shifted from Sat ..."), "wkday" = Mon–Thu payday, "all" = both pooled.
- accuracy.model / accuracy.llm: decayed sums; WAPE = absErr/actual, bias = signedErr/actual.

Write:
1. summary: at most 120 words, plain language for a store manager — what drives this branch's sales, using only numbers present in the JSON.
2. flags: at most 5 short observations worth acting on, e.g. a factor based on fewer than 3 days, an unstable weekday (mad above 0.25), whether Friday paydays lift more than midweek ones, whether shifted Friday paydays differ from natural ones, a factor whose recent evidence disagrees with its liftPct, the model beating or trailing the AI forecast.

Never invent numbers. If data is too thin to say something, say so.

MODEL JSON:
${JSON.stringify(facts)}`;
}

export async function explainForecastModel(model: ForecastModel): Promise<ModelExplanation> {
  const promptText = buildExplainPrompt(model);
  if (isClaudeConfigured()) {
    try {
      const r = await explainWithClaude(promptText);
      return { summary: r.summary.slice(0, 1200), flags: r.flags.slice(0, 5), provider: "claude" };
    } catch (e) {
      console.warn("[explainForecastModel] Claude failed, falling back to Gemini:", e);
    }
  }
  const { output } = await ai.generate({ prompt: promptText, output: { schema: ExplanationSchema } });
  if (!output) throw new Error("Gemini returned no explanation");
  return { summary: output.summary.slice(0, 1200), flags: output.flags.slice(0, 5), provider: "gemini" };
}
