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

const ForecastInputSchema = z.object({
  historicalSales: z.array(DailySaleSchema).describe("An array of historical daily sales data for the past few weeks."),
  storeLocation: z.string().describe("The location of the store, e.g., 'Manila, Philippines'."),
  upcomingPayrollDates: z.array(z.string()).describe("A list of upcoming payroll dates in YYYY-MM-DD format. Sales may increase on or after these dates.").optional(),
  upcomingHolidays: z.array(z.string()).describe("A list of upcoming local holidays, e.g., 'National Heroes Day'. Sales may be higher or lower depending on the holiday.").optional(),
  historicalWeather: z.array(z.object({
      date: z.string().describe("The date in YYYY-MM-DD format."),
      condition: z.string().describe("A summary of weather conditions for that day, e.g., 'mostly sunny', 'rainy'."),
  })).describe("An array of historical daily weather data.").optional(),
  currentWeather: z.string().describe("The current weather condition, e.g., 'Sunny', 'Cloudy', 'Rainy'.").optional(),
});
export type ForecastInput = z.infer<typeof ForecastInputSchema>;

const ForecastedDaySchema = z.object({
    day: z.string().describe("The day of the week for the forecast (e.g., Monday, Tuesday)."),
    forecastedSales: z.number().describe("The forecasted net sales for that day."),
});

const ForecastOutputSchema = z.object({
    forecast: z.array(ForecastedDaySchema).describe("An array of 7 objects, each representing a day's forecast for the next week.")
});
export type ForecastOutput = z.infer<typeof ForecastOutputSchema>;

export async function forecastWeeklySales(input: ForecastInput): Promise<ForecastOutput> {
  return forecastWeeklySalesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'forecastWeeklySalesPrompt',
  model: "googleai/gemini-pro",
  input: {schema: ForecastInputSchema},
  output: {schema: ForecastOutputSchema},
  prompt: `You are a data analyst for a restaurant located in {{{storeLocation}}}. Based on the following information, provide a realistic day-by-day sales forecast for the next 7 days.

Your analysis must consider multiple factors:
1.  **Historical Data**: Analyze the provided sales data to identify weekly trends, such as higher sales on weekends (Friday, Saturday, Sunday) and lower sales on weekdays.
2.  **Weather**: The current weather is '{{{currentWeather}}}'. Consider historical weather patterns. Rainy days often lead to lower sales, while sunny days might increase them.
3.  **Paydays**: Check for any upcoming payroll dates. Sales typically see a significant spike on and immediately after payroll dates.
4.  **Holidays**: Consider any upcoming local holidays. Some holidays boost sales (e.g., Christmas), while others might decrease them if people leave town.

**Input Data:**

*   **Store Location**: {{{storeLocation}}}
*   **Current Weather**: {{{currentWeather}}}
*   **Historical Sales**:
{{#each historicalSales}}
    *   {{date}}: {{netSales}}
{{/each}}
*   **Historical Weather**:
{{#if historicalWeather}}
{{#each historicalWeather}}
    *   {{date}}: {{condition}}
{{/each}}
{{else}}
    *   No historical weather data available.
{{/if}}
*   **Upcoming Payroll Dates**: 
{{#if upcomingPayrollDates}}
{{#each upcomingPayrollDates}}
    *   {{{this}}}
{{/each}}
{{else}}
    *   None specified.
{{/if}}
*   **Upcoming Holidays**: 
{{#if upcomingHolidays}}
{{#each upcomingHolidays}}
    *   {{{this}}}
{{/each}}
{{else}}
    *   None specified.
{{/if}}

Provide the forecast for the next week, starting from tomorrow. The output must be a JSON object containing a 'forecast' array with exactly 7 objects, each with a 'day' (e.g., "Monday") and a 'forecastedSales' property. Do not include any other text or reasoning in your response.
`,
});

const forecastWeeklySalesFlow = ai.defineFlow(
  {
    name: 'forecastWeeklySalesFlow',
    inputSchema: ForecastInputSchema,
    outputSchema: ForecastOutputSchema,
  },
  async input => {
    try {
      const { output } = await prompt(input);
      if (!output) throw new Error("Forecast prompt returned no output");
      return output;
    } catch (e) {
      console.error("[forecastWeeklySalesFlow] failed:", e);
      throw e; // keep throwing so route error boundary/logs catch it
    }
  }
);
