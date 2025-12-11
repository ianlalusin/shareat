
'use server';

import { ai } from '@/ai/genkit';
import { z } from 'zod';

export const ShiftStatsSchema = z.object({
  storeId: z.string(),
  ordersCount: z.number(),
  totalGuests: z.number(),
  topPackages: z.array(z.object({ name: z.string(), count: z.number() })),
  refillStats: z.array(
    z.object({
      meatType: z.string(),
      totalRefills: z.number(),
      topFlavors: z.array(z.string()),
    })
  ),
  totalDiscounts: z.number(),
  totalCharges: z.number(),
});

export type ShiftStats = z.infer<typeof ShiftStatsSchema>;

export const AISummarySchema = z.object({
  summary: z
    .string()
    .describe('A 4-5 sentence summary of the shift performance.'),
});

export type AISummary = z.infer<typeof AISummarySchema>;

export const summarizeShiftFlow = ai.defineFlow(
  {
    name: 'summarizeShiftFlow',
    inputSchema: ShiftStatsSchema,
    outputSchema: AISummarySchema,
  },
  async (stats) => {
    const prompt = `You are an operations analyst for a samgyupsal restaurant chain called SharEat Hub. You will receive a JSON object with shift statistics. Your task is to return a short, insightful paragraph summarizing the shift's performance, highlighting key menu items, refill patterns, and any operational insights. The summary should be in plain English or Taglish and be a maximum of 4-5 sentences.

Here is the data for the shift:
${JSON.stringify(stats, null, 2)}
`;

    const llmResponse = await ai.generate({
      prompt: prompt,
      output: {
        schema: AISummarySchema,
      },
    });

    return llmResponse.output!;
  }
);
