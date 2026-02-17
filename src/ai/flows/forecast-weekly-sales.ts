'use server';
/**
 * @fileOverview A sales forecasting AI agent.
 *
 * - forecastWeeklySales - A function that handles the sales forecasting process.
 * - ForecastInput - The input type for the forecastWeeklySales function.
 * - ForecastOutput - The return type for the forecastWeeklySales function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const DailySaleSchema = z.object({
  date: z.string().describe("The date of the sales data in YYYY-MM-DD format."),
  netSales: z.number().describe("The total net sales for that day."),
});

export const ForecastInputSchema = z.object({
  historicalSales: z.array(DailySaleSchema).describe("An array of historical daily sales data for the past few weeks."),
});
export type ForecastInput = z.infer<typeof ForecastInputSchema>;

const ForecastedDaySchema = z.object({
    day: z.string().describe("The day of the week for the forecast (e.g., Monday, Tuesday)."),
    forecastedSales: z.number().describe("The forecasted net sales for that day."),
});

export const ForecastOutputSchema = z.object({
    forecast: z.array(ForecastedDaySchema).describe("An array of 7 objects, each representing a day's forecast for the next week.")
});
export type ForecastOutput = z.infer<typeof ForecastOutputSchema>;

export async function forecastWeeklySales(input: ForecastInput): Promise<ForecastOutput> {
  return forecastWeeklySalesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'forecastWeeklySalesPrompt',
  input: {schema: ForecastInputSchema},
  output: {schema: ForecastOutputSchema},
  prompt: `You are a data analyst for a restaurant. Based on the following daily sales data, provide a realistic day-by-day sales forecast for the next 7 days.

Analyze the historical data to identify weekly trends, such as higher sales on weekends (Friday, Saturday) and lower sales on weekdays. Your forecast should reflect these patterns.

Historical Sales Data:
{{#each historicalSales}}
- {{date}}: ₱{{netSales}}
{{/each}}

Provide the forecast for the next week, starting from tomorrow. The output must be a JSON object containing a 'forecast' array with exactly 7 objects, each with a 'day' (e.g., "Monday") and a 'forecastedSales' property.
`,
});

const forecastWeeklySalesFlow = ai.defineFlow(
  {
    name: 'forecastWeeklySalesFlow',
    inputSchema: ForecastInputSchema,
    outputSchema: ForecastOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
