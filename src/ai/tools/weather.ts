'use server';
import {ai} from '@/ai/genkit';
import {z} from 'genkit';

export const getWeatherForecast = ai.defineTool(
  {
    name: 'getWeatherForecast',
    description: 'Get the 7-day weather forecast for a specific location.',
    inputSchema: z.object({
      location: z.string().describe('The city or area to get the weather for, e.g., "Manila, Philippines".'),
    }),
    outputSchema: z.object({
      forecast: z.array(z.object({
        day: z.string().describe("Day of the week."),
        condition: z.string().describe("e.g., Sunny, Rainy, Cloudy."),
        temperature: z.string().describe("e.g., 32°C"),
      })),
    }),
  },
  async (input) => {
    // In a real application, you would implement a call to a weather API here.
    // For this prototype, we'll return a placeholder forecast.
    console.log(`[getWeatherForecast tool] Called for: ${input.location}`);
    
    // Placeholder logic: return a sunny forecast if the location is known, otherwise generic.
    const isKnownCity = input.location.toLowerCase().includes('manila') || input.location.toLowerCase().includes('quezon city');
    
    const placeholderForecast = [
        { day: 'Monday', condition: isKnownCity ? 'Sunny' : 'Partly Cloudy', temperature: '32°C' },
        { day: 'Tuesday', condition: 'Sunny', temperature: '33°C' },
        { day: 'Wednesday', condition: 'Chance of rain', temperature: '31°C' },
        { day: 'Thursday', condition: 'Sunny', temperature: '33°C' },
        { day: 'Friday', condition: 'Partly Cloudy', temperature: '32°C' },
        { day: 'Saturday', condition: 'Sunny', temperature: '34°C' },
        { day: 'Sunday', condition: 'Sunny', temperature: '34°C' },
    ];
    
    return { forecast: placeholderForecast };
  }
);
