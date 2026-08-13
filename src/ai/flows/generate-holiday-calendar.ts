'use server';
/**
 * @fileOverview AI holiday/occasion calendar generator.
 * Returns dated holidays + commercial occasions + local fiestas for a locale and
 * one or more years. One Gemini call covers all requested years.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const EntrySchema = z.object({
  dayId: z.string().describe('Date as YYYYMMDD for the specific year requested.'),
  name: z.string().describe("Holiday or occasion name, e.g. \"Father's Day\"."),
  type: z.enum(['national', 'religious', 'commercial', 'fiesta', 'other']),
  scope: z.enum(['national', 'local']).describe("'local' for town/city fiestas specific to the locale."),
  driver: z.enum(['up', 'down', 'neutral']).describe('Coarse expected effect on restaurant dine-in sales.'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Certainty of the date and that it is observed in this locale.'),
});

const InputSchema = z.object({
  locale: z.string().describe("Store location, e.g. 'Malvar, Batangas, Philippines'."),
  years: z.array(z.number()).describe('Calendar years to produce, e.g. [2025, 2026].'),
});
export type HolidayCalendarFlowInput = z.infer<typeof InputSchema>;

const OutputSchema = z.object({
  entries: z.array(EntrySchema).describe('All holidays/occasions across the requested years.'),
});
export type HolidayCalendarFlowOutput = z.infer<typeof OutputSchema>;

export async function generateHolidayCalendar(input: HolidayCalendarFlowInput): Promise<HolidayCalendarFlowOutput> {
  return holidayCalendarFlow(input);
}

const prompt = ai.definePrompt({
  name: 'holidayCalendarPrompt',
  model: 'googleai/gemini-3.6-flash',
  input: { schema: InputSchema },
  output: { schema: OutputSchema },
  prompt: `You build a sales-relevant holiday & special-occasion calendar for a restaurant located in {{{locale}}}.

For EACH requested year ({{#each years}}{{{this}}} {{/each}}), list every date that could move restaurant dine-in sales:
- Philippine REGULAR holidays and SPECIAL (non-working) holidays, with the correct date for that year.
- Movable religious dates resolved per year: Holy Week (incl. Maundy Thursday, Good Friday, Black Saturday, Easter Sunday), Eid'l Fitr, Eid'l Adha, Chinese New Year.
- Widely-observed COMMERCIAL occasions even if not non-working: Valentine's Day, Mother's Day (2nd Sunday of May), Father's Day (3rd Sunday of June), Halloween, Christmas Eve, New Year's Eve, etc.
- LOCAL fiestas / town or city celebrations specific to {{{locale}}} (mark scope 'local').

Rules:
- Output a flat 'entries' array. One object per (date, occasion). 'dayId' MUST be YYYYMMDD for the specific year.
- Only include real, dated events. Do NOT invent fiestas you are unsure of — use confidence 'low' if unsure, or omit.
- 'driver' is the likely direction for a dine-in restaurant: 'up' (people dine out / celebrate), 'down' (people travel away or stay home), or 'neutral'.
- Do not include ordinary paydays or weekends.

Return ONLY the structured JSON.`,
});

const holidayCalendarFlow = ai.defineFlow(
  { name: 'holidayCalendarFlow', inputSchema: InputSchema, outputSchema: OutputSchema },
  async (input) => {
    const { output } = await prompt(input);
    if (!output) throw new Error('Holiday calendar prompt returned no output');
    return output;
  },
);
