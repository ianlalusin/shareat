import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";

/**
 * Claude is the primary model for the daily sales forecast; Gemini (Genkit) is
 * the fallback. Unset ANTHROPIC_API_KEY → Claude is skipped entirely.
 */
const CLAUDE_FORECAST_MODEL = process.env.CLAUDE_FORECAST_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;

export function isClaudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ timeout: 120_000, maxRetries: 2 });
  return client;
}

// Mirrors ForecastOutputSchema in flows/forecast-weekly-sales.ts (that one is
// Genkit's zod v3; the SDK helper needs zod v4).
const ClaudeForecastSchema = z.object({
  forecast: z
    .array(
      z.object({
        day: z.string(),
        forecastedSales: z.number(),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .length(7),
});
export type ClaudeForecast = z.infer<typeof ClaudeForecastSchema>;

/** Runs the already-rendered forecast prompt on Claude. Throws on any failure so the caller can fall back. */
export async function forecastWithClaude(promptText: string): Promise<ClaudeForecast> {
  const response = await getClient().messages.parse({
    model: CLAUDE_FORECAST_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(ClaudeForecastSchema) },
    messages: [{ role: "user", content: promptText }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude refused: ${response.stop_details?.category ?? "unknown"}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Claude hit max_tokens");
  if (!response.parsed_output) throw new Error("Claude returned no parseable forecast");
  return response.parsed_output;
}

const ExplanationSchema = z.object({
  summary: z.string(),
  flags: z.array(z.string()).max(5),
});
export type ClaudeExplanation = z.infer<typeof ExplanationSchema>;

/** Weekly plain-language review of a learned forecast model. Throws on any failure so the caller can fall back. */
export async function explainWithClaude(promptText: string): Promise<ClaudeExplanation> {
  const response = await getClient().messages.parse({
    model: CLAUDE_FORECAST_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(ExplanationSchema) },
    messages: [{ role: "user", content: promptText }],
  });
  if (response.stop_reason === "refusal") throw new Error(`Claude refused: ${response.stop_details?.category ?? "unknown"}`);
  if (response.stop_reason === "max_tokens") throw new Error("Claude hit max_tokens");
  if (!response.parsed_output) throw new Error("Claude returned no parseable explanation");
  return response.parsed_output;
}
