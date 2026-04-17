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

const DayOfWeekAverageSchema = z.object({
  day: z.string().describe("Day of the week, e.g., 'Monday'."),
  averageSales: z.number().describe("Average net sales for this day of the week."),
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
  dayOfWeekAverages: z.array(DayOfWeekAverageSchema).describe("Pre-computed average sales per day of week from historical data.").optional(),
  trendDirection: z.enum(["up", "down", "flat"]).describe("Whether recent sales are trending up, down, or flat compared to the prior period.").optional(),
  recentVsHistoricalRatio: z.number().describe("Ratio of last-7-day average to prior-7-day average. >1 means sales are above average.").optional(),
  storeContext: z.string().describe("Free-text context about the store, e.g., 'near a university, busy during enrollment'.").optional(),
});
export type ForecastInput = z.infer<typeof ForecastInputSchema>;

const ForecastedDaySchema = z.object({
    day: z.string().describe("The day of the week for the forecast (e.g., Monday, Tuesday)."),
    forecastedSales: z.number().describe("The forecasted net sales for that day."),
    confidence: z.enum(["high", "medium", "low"]).describe("Confidence level: 'high' when strong historical patterns exist, 'medium' for moderate certainty, 'low' when data is sparse or unusual factors apply."),
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
  model: "googleai/gemini-2.5-flash",
  input: {schema: ForecastInputSchema},
  output: {schema: ForecastOutputSchema},
  prompt: `You are a data analyst for a restaurant located in {{{storeLocation}}}. Based on the following information, provide a realistic day-by-day sales forecast for the next 7 days.

Your analysis must consider multiple factors:
1.  **Historical Data**: Analyze the provided sales data to identify weekly trends, such as higher sales on weekends (Friday, Saturday, Sunday) and lower sales on weekdays. Use the pre-computed day-of-week averages as a baseline.
2.  **Trend**: The recent trend is '{{{trendDirection}}}' with a ratio of {{{recentVsHistoricalRatio}}} (>1 means recent sales are above the prior period average). Factor this momentum into your forecast.
3.  **Weather**: The current weather is '{{{currentWeather}}}'. Consider historical weather patterns. Rainy days often lead to lower sales, while sunny days might increase them.
4.  **Paydays**: Check for any upcoming payroll dates. Sales typically see a significant spike on and immediately after payroll dates.
5.  **Holidays**: Consider any upcoming local holidays. Some holidays boost sales (e.g., Christmas), while others might decrease them if people leave town.

**Input Data:**

*   **Store Location**: {{{storeLocation}}}
{{#if storeContext}}
*   **Store Context**: {{{storeContext}}}
{{/if}}
*   **Current Weather**: {{{currentWeather}}}
*   **Historical Sales**:
{{#each historicalSales}}
    *   {{date}}: {{netSales}}
{{/each}}
*   **Day-of-Week Averages**:
{{#if dayOfWeekAverages}}
{{#each dayOfWeekAverages}}
    *   {{day}}: {{averageSales}}
{{/each}}
{{else}}
    *   Not available.
{{/if}}
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

Provide the forecast for the next 7 days, starting from today. The output must be a JSON object containing a 'forecast' array with exactly 7 objects, each with a 'day' (e.g., "Monday"), a 'forecastedSales' property, and a 'confidence' property ('high', 'medium', or 'low'). Set confidence to 'high' when the day has strong consistent patterns, 'medium' for moderate certainty, and 'low' when data is sparse or unusual factors (holidays, weather changes) introduce uncertainty. Do not include any other text or reasoning in your response.
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
