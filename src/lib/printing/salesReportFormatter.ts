'use client';

import { format } from "date-fns";

export interface SalesReportData {
  storeName: string;
  branchName?: string;
  address?: string;
  reportType: "daily" | "monthly";
  dateLabel: string;
  generatedAt: Date;
  generatedBy?: string;
  totalGross: number;
  txCount: number;
  byMethod: Record<string, number>;
  cashRemitted: number;
  onlineRemitted: number;
  discountsTotal: number;
  chargesTotal: number;
  voidedQty: number;
  voidedAmount: number;
  freeQty: number;
  freeAmount: number;
  discountedQty: number;
  discountedAmount: number;
  refundCount: number;
  refundTotal: number;
  addonSalesByItem: Record<string, { qty: number; amount: number; categoryName: string }>;
}

export function formatSalesReportText(data: SalesReportData, width: 58 | 80 = 80): string {
  const charsPerLine = width === 58 ? 32 : 48;
  const lines: string[] = [];

  const center = (text: string) => {
    const padding = Math.max(0, Math.floor((charsPerLine - text.length) / 2));
    return " ".repeat(padding) + text;
  };
  const justify = (left: string, right: string) => {
    const maxLeft = charsPerLine - right.length - 1;
    const trimmedLeft = left.length > maxLeft ? left.substring(0, maxLeft - 1) + "." : left;
    const space = charsPerLine - trimmedLeft.length - right.length;
    return trimmedLeft + " ".repeat(Math.max(1, space)) + right;
  };
  const hr = () => "-".repeat(charsPerLine);
  const fmtAmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // --- Store Header ---
  if (data.storeName) lines.push(center(data.storeName.toUpperCase()));
  if (data.branchName && data.branchName.toLowerCase() !== data.storeName?.toLowerCase()) {
    lines.push(center(data.branchName));
  }
  if (data.address) lines.push(center(data.address));
  lines.push("");

  // --- Report Title ---
  const title = data.reportType === "daily" ? "DAILY SALES REPORT" : "MONTHLY SALES REPORT";
  lines.push(center(title));
  lines.push(center(data.dateLabel));
  lines.push("");
  lines.push(justify("Generated:", format(data.generatedAt, "MM/dd/yy HH:mm")));
  if (data.generatedBy) {
    lines.push(justify("By:", data.generatedBy));
  }
  lines.push(hr());

  // --- Total Sales ---
  lines.push(center("TOTAL SALES"));
  lines.push(hr());
  lines.push(justify("Gross Sales", fmtAmt(data.totalGross)));
  lines.push(justify("Transactions", String(data.txCount)));
  lines.push(hr());

  // --- Sales Per Channel / Mode of Payment ---
  lines.push(center("MODE OF PAYMENT"));
  lines.push(hr());
  const sortedMethods = Object.entries(data.byMethod).sort(([, a], [, b]) => b - a);
  for (const [method, amount] of sortedMethods) {
    const label = method.length > charsPerLine - 12 ? method.substring(0, charsPerLine - 13) + "." : method;
    lines.push(justify(label, fmtAmt(amount)));
  }
  lines.push(hr());
  lines.push(justify("TOTAL", fmtAmt(data.totalGross)));
  lines.push(hr());

  // --- Discounts & Charges ---
  lines.push(center("DISCOUNTS & CHARGES"));
  lines.push(hr());
  lines.push(justify("Discounts", data.discountsTotal > 0 ? `(${fmtAmt(data.discountsTotal)})` : "0.00"));
  lines.push(justify("Charges", data.chargesTotal > 0 ? `+${fmtAmt(data.chargesTotal)}` : "0.00"));
  lines.push(hr());

  // --- Item Adjustments ---
  lines.push(center("ITEM ADJUSTMENTS"));
  lines.push(hr());
  const adjNameW = width === 58 ? 16 : 24;
  const adjQtyW = width === 58 ? 6 : 10;
  const adjAmtW = charsPerLine - adjNameW - adjQtyW;

  const adjRow = (label: string, qty: number, amount: number) => {
    const qStr = `${qty} pcs`;
    const aStr = fmtAmt(amount);
    const usedQty = Math.max(adjQtyW, qStr.length);
    const usedAmt = Math.max(adjAmtW, aStr.length);
    const nameSpace = charsPerLine - usedQty - usedAmt;
    const l = label.substring(0, nameSpace).padEnd(nameSpace);
    return l + qStr.padStart(usedQty) + aStr.padStart(usedAmt);
  };

  lines.push(adjRow("Discounted", data.discountedQty, data.discountedAmount));
  lines.push(adjRow("Voided", data.voidedQty, data.voidedAmount));
  lines.push(adjRow("Free", data.freeQty, data.freeAmount));
  lines.push(adjRow("Refunds", data.refundCount, data.refundTotal));
  lines.push(hr());

  // --- Items Sold Breakdown ---
  const addonEntries = Object.entries(data.addonSalesByItem).sort(([, a], [, b]) => b.amount - a.amount);
  if (addonEntries.length > 0) {
    lines.push(center("ITEMS SOLD BREAKDOWN"));
    lines.push(hr());

    const qtyW = width === 58 ? 5 : 6;
    const amtW = width === 58 ? 9 : 12;
    const nameW = charsPerLine - qtyW - amtW;

    lines.push(
      "Item".padEnd(nameW) + "Qty".padStart(qtyW) + "Amount".padStart(amtW)
    );
    lines.push(hr());

    for (const [name, info] of addonEntries) {
      const truncName = name.length > nameW - 1 ? name.substring(0, nameW - 2) + "." : name;
      lines.push(
        truncName.padEnd(nameW) +
        String(info.qty).padStart(qtyW) +
        fmtAmt(info.amount).padStart(amtW)
      );
    }
    lines.push(hr());
  }

  // --- Footer ---
  lines.push("");
  lines.push(center("** END OF REPORT **"));
  lines.push("\n\n\n\n");

  return lines.join("\n");
}
