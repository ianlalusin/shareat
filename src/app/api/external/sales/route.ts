import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { validateExternalApiKey } from "@/lib/server/external-auth";

export const runtime = "nodejs";

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

  const dayId = date.replace(/-/g, "");

  try {
    const db = getAdminDb();
    const docRef = db.doc(`stores/${storeId}/analytics/${dayId}`);
    const snap = await docRef.get();

    if (!snap.exists) {
      return NextResponse.json({
        storeId,
        date,
        found: false,
        message: "No analytics data for this date.",
      });
    }

    const d = snap.data()!;
    const payments = d.payments ?? {};
    const sales = d.sales ?? {};
    const guests = d.guests ?? {};

    const totalGross = payments.totalGross ?? 0;
    const byMethod: Record<string, number> = payments.byMethod ?? {};

    // Dine-in sales = gross (before discounts/charges)
    const dineInSalesGross = Number(sales.dineInSalesGross ?? 0);
    // Fallback to net if gross not yet backfilled
    const dineInSales = dineInSalesGross > 0
      ? dineInSalesGross
      : Object.values(sales.packageSalesAmountByName ?? {})
          .reduce((sum: number, v: any) => sum + (Number(v) || 0), 0)
        + Number(sales.dineInAddonSalesAmount ?? 0);
    const takeOutSales = Math.max(0, totalGross - dineInSales);

    // Categorize payment methods
    let cashPayments = 0;
    let eWalletPayments = 0;
    let creditCardPayments = 0;
    let otherPayments = 0;

    const cashKeys = ["cash"];
    const eWalletKeys = ["gcash", "maya", "paymaya", "grabpay", "shopeepay", "e-wallet", "ewallet"];
    const cardKeys = ["card", "credit card", "creditcard", "debit card", "debitcard"];

    for (const [method, amount] of Object.entries(byMethod)) {
      const key = method.toLowerCase().trim();
      if (cashKeys.includes(key)) {
        cashPayments += Number(amount) || 0;
      } else if (eWalletKeys.some((k) => key.includes(k))) {
        eWalletPayments += Number(amount) || 0;
      } else if (cardKeys.some((k) => key.includes(k))) {
        creditCardPayments += Number(amount) || 0;
      } else {
        otherPayments += Number(amount) || 0;
      }
    }

    return NextResponse.json({
      storeId,
      date,
      found: true,
      totalSales: totalGross,
      totalSessions: payments.txCount ?? 0,
      dineInSales,
      takeOutSales,
      cashPayments,
      eWalletPayments,
      creditCardPayments,
      otherPayments,
      paymentsByMethod: byMethod,
      discountsTotal: payments.discountsTotal ?? 0,
      chargesTotal: payments.chargesTotal ?? 0,
      guestCount: guests.guestCountFinalTotal ?? 0,
      packageSessions: guests.packageSessionsCount ?? 0,
    });
  } catch (err: any) {
    console.error("[external/sales] failed:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch sales data." }, { status: 500 });
  }
}
