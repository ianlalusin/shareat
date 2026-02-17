export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
  });
}
