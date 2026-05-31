import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { validateExternalApiKey } from "@/lib/server/external-auth";

export const runtime = "nodejs";

/**
 * External feedback aggregate for one store + day. Mirrors the sales endpoint's
 * auth + param contract. Reads the customer-app feedback the CustomerFeedback
 * modal writes to stores/{storeId}/customerFeedbackDays/{MMDDYYYY} (chunked
 * -01..-20, max 400/doc) and returns a day-level summary.
 */
export async function GET(request: Request) {
  const authError = validateExternalApiKey(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("storeId");
  const date = searchParams.get("date"); // YYYY-MM-DD

  if (!storeId) return NextResponse.json({ error: "Missing storeId." }, { status: 400 });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Missing or invalid date. Use YYYY-MM-DD." }, { status: 400 });
  }

  // Feedback day docs are keyed MMDDYYYY (the customer app's mmddyyyy()).
  const [y, m, d] = date.split("-");
  const dayKey = `${m}${d}${y}`;

  try {
    const db = getAdminDb();
    const col = db.collection(`stores/${storeId}/customerFeedbackDays`);

    // Walk the base doc + chunks until one is missing.
    const entries: any[] = [];
    for (let i = 0; i <= 20; i++) {
      const docId = i === 0 ? dayKey : `${dayKey}-${String(i).padStart(2, "0")}`;
      const snap = await col.doc(docId).get();
      if (!snap.exists) break;
      const arr = (snap.data() as any)?.feedbacks;
      if (Array.isArray(arr)) entries.push(...arr);
    }

    if (entries.length === 0) {
      return NextResponse.json({
        storeId, date, found: false, count: 0, avgRating: 0,
        ratingCounts: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }, suggestions: [],
      });
    }

    const ratingCounts: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    let sum = 0;
    const suggestions: string[] = [];
    for (const e of entries) {
      const r = Math.round(Number(e?.rating) || 0);
      if (r >= 1 && r <= 5) {
        ratingCounts[String(r)] += 1;
        sum += r;
      }
      const s = String(e?.suggestion || "").trim();
      if (s && suggestions.length < 15) suggestions.push(s);
    }
    const count = entries.length;
    const avgRating = count > 0 ? Math.round((sum / count) * 100) / 100 : 0;

    return NextResponse.json({ storeId, date, found: true, count, avgRating, ratingCounts, suggestions });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
