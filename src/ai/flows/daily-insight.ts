'use server';
/**
 * @fileOverview AI daily-performance insight agent.
 *
 * Reads a deterministic, server-computed digest of YESTERDAY's performance (with
 * comparisons already calculated) and returns a narrative analysis: summary,
 * per-area read (sales, operations, inventory, anomalies) and suggestions.
 *
 * IMPORTANT: the model must NOT invent or recompute numbers. Every figure it
 * cites must come from the provided digest; the UI renders the authoritative
 * figures from the server-computed metric chips, not from this prose.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const DailyInsightInputSchema = z.object({
  storeName: z.string().describe('The store/branch name.'),
  dateLabel: z.string().describe("Human label for the analyzed day, e.g. 'Saturday, 14 Jun 2026'."),
  dayOfWeek: z.string().describe("Day of week of the analyzed day, e.g. 'Saturday'."),
  metricsDigest: z.string().describe('A pre-computed, human-readable digest of yesterday\'s metrics WITH comparisons (vs prior day, vs same weekday average, vs 7-day average). This is the ONLY source of numbers — do not invent or recompute any figure.'),
  weatherContext: z.string().optional().describe("Weather for the analyzed day and the next 1-2 days, and this branch's rain sensitivity, for tactical suggestions."),
  dayContext: z.string().optional().describe('Payday / holiday / weekday context for the analyzed day and today.'),
});
export type DailyInsightInput = z.infer<typeof DailyInsightInputSchema>;

const SectionSchema = z.object({
  headline: z.string().describe('A short, punchy one-line takeaway for this section (no raw numbers required; numbers are shown separately).'),
  narrative: z.string().describe('2-5 sentences of data-driven analysis, comparison and synthesis for this area. Reference figures ONLY from the digest.'),
  flags: z.array(z.string()).describe('Short, specific issues or things to watch in this area. Empty array if nothing notable.'),
});

const DailyInsightOutputSchema = z.object({
  summary: z.object({
    headline: z.string().describe("A single-sentence at-a-glance verdict on yesterday's performance."),
    bullets: z.array(z.string()).describe('3-5 quick-glance bullets covering the most important takeaways across all areas.'),
    sentiment: z.enum(['good', 'mixed', 'poor']).describe('Overall sentiment for the day.'),
  }),
  sales: SectionSchema.describe('Sales performance: revenue, covers, avg basket, package mix, peak/slow hours, dine-in vs walk-in, payment mix, vs prior days.'),
  operations: SectionSchema.describe("Operations: time to attend (server confirm), kitchen serve times, avg session duration, guest inflow by hour, busiest/idle windows, cancellations, AND staff responsiveness to customer 'need assistance' taps (request count, answered vs unanswered, avg/slowest response, % within 2 min)."),
  inventory: SectionSchema.describe('Menu-item movement (from sales): fast movers and items that barely moved among add-ons/refills/packages, plus weather/day-driven push tactics for today. Note this is sell-through, not raw stock.'),
  anomalies: SectionSchema.describe('Anomalies worth attention: high voids/discounts/free items, refunds, high charges, payment-method skew, long no-guest hours (possible closure), and anything unusual.'),
  suggestions: z.array(z.object({
    text: z.string().describe('A concrete, actionable suggestion.'),
    area: z.enum(['sales', 'ops', 'inventory', 'general']),
    priority: z.enum(['high', 'medium', 'low']),
  })).describe('3-6 prioritized, actionable suggestions for today based on yesterday.'),
});
export type DailyInsightOutput = z.infer<typeof DailyInsightOutputSchema>;

export async function generateDailyInsight(input: DailyInsightInput): Promise<DailyInsightOutput> {
  return dailyInsightFlow(input);
}

const prompt = ai.definePrompt({
  name: 'dailyInsightPrompt',
  model: 'googleai/gemini-2.5-flash',
  input: { schema: DailyInsightInputSchema },
  output: { schema: DailyInsightOutputSchema },
  prompt: `You are a sharp restaurant operations & sales analyst for "{{{storeName}}}". You are writing the manager's morning brief about how the business did YESTERDAY ({{{dateLabel}}}), so they can act today.

Analyze the digest below and produce: an at-a-glance summary, a focused read of Sales, Operations, Inventory (menu-item movement), and Anomalies, and a short list of prioritized suggestions for today.

RULES:
- Do NOT invent, estimate, or recompute any number. Cite only figures that appear in the digest. If a figure isn't in the digest, speak qualitatively instead.
- Be comparative and synthetic: explain what changed vs the prior day / same weekday / 7-day average and WHY it matters — don't just restate the numbers.
- Be specific and concrete. Prefer "Galbi refills doubled vs the Saturday average" over "refills did well".
- Inventory is SELL-THROUGH of menu items (add-ons, refills, packages), not raw stock — frame tactics accordingly (what to prep/push today given the weather and day).
- Flags are short and only for genuinely notable issues. Empty arrays are fine.
- Keep narratives tight (2-5 sentences). No markdown headers in your text.

=== YESTERDAY'S DIGEST ({{{dayOfWeek}}}) ===
{{{metricsDigest}}}

{{#if weatherContext}}
=== WEATHER ===
{{{weatherContext}}}
{{/if}}
{{#if dayContext}}
=== DAY CONTEXT ===
{{{dayContext}}}
{{/if}}

Return the structured JSON only.`,
});

const dailyInsightFlow = ai.defineFlow(
  {
    name: 'dailyInsightFlow',
    inputSchema: DailyInsightInputSchema,
    outputSchema: DailyInsightOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    if (!output) throw new Error('Daily insight prompt returned no output');
    return output;
  }
);
