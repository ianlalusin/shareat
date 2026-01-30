
'use client';

import { toJsDate } from "@/lib/utils/date";
import type { ReceiptData, SessionBillLine } from "@/lib/types";
import { format } from "date-fns";

/**
 * Formats receipt data into plain text for thermal printing (ESC/POS).
 * This utility focuses strictly on text formatting and alignment.
 * 
 * @param data The shared ReceiptData object.
 * @param width The paper width in mm (58 or 80).
 * @returns A string formatted for monospaced printing.
 */
export function formatReceiptText(data: ReceiptData, width: 58 | 80 = 80): string {
  const charsPerLine = width === 58 ? 32 : 48;
  
  let qtyWidth: number;
  let priceWidth: number;
  let nameWidth: number;

  if (width === 58) {
    qtyWidth = 3;     // " 1 "
    priceWidth = 9;   // " 1234.56"
    nameWidth = charsPerLine - qtyWidth - priceWidth; // 20
  } else {
    qtyWidth = 4;
    priceWidth = 12;
    nameWidth = charsPerLine - qtyWidth - priceWidth; // 32
  }

  const lines: string[] = [];

  const center = (text: string) => {
    const safeText = text.slice(0, charsPerLine);
    const padding = Math.max(0, Math.floor((charsPerLine - safeText.length) / 2));
    return " ".repeat(padding) + safeText;
  };

  const justify = (left: string, right: string) => {
    const space = charsPerLine - left.length - right.length;
    if (space <= 0) {
        // Truncate left string to fit if they are too long combined
        const availableForLeft = charsPerLine - right.length - 1;
        return left.slice(0, availableForLeft) + " " + right;
    }
    return left + " ".repeat(space) + right;
  };

  const hr = () => "-".repeat(charsPerLine);

  // --- HEADER ---
  const settings = data.settings;
  if (settings.businessName) lines.push(center(settings.businessName.toUpperCase()));
  if (settings.address) lines.push(center(settings.address));
  if (settings.contact) lines.push(center(settings.contact));
  if (settings.tin) lines.push(center(`TIN: ${settings.tin} ${settings.vatType === 'VAT' ? 'VAT' : 'Non-VAT'}`));
  lines.push("");

  const receiptDate = toJsDate(data.receiptCreatedAt) ?? toJsDate(data.session.closedAt);
  lines.push(justify("DATE:", receiptDate ? format(receiptDate, "MM/dd/yy HH:mm") : "N/A"));
  lines.push(justify("RECEIPT:", data.receiptNumber ?? "—"));
  
  if (settings.showTableOrCustomer) {
    const label = data.session.sessionMode === 'alacarte' ? "CUSTOMER:" : "TABLE:";
    const val = data.session.sessionMode === 'alacarte' 
        ? (data.session.customer?.name || data.session.customerName || "N/A")
        : (data.session.tableNumber || "N/A");
    lines.push(justify(label, val));
  }
  
  if (settings.showCashierName) {
    lines.push(justify("CASHIER:", data.createdByUsername || "N/A"));
  }

  lines.push(hr());

  // --- ITEMS ---
  const headerRow = 'Qty'.padEnd(qtyWidth) + 'Item'.padEnd(nameWidth) + 'Total'.padStart(priceWidth);
  lines.push(headerRow);

  const activeLines = (data.lines || []).filter(l => (l.qtyOrdered - (l.voidedQty || 0)) > 0);
  activeLines.forEach(line => {
    const billableQty = line.qtyOrdered - (line.voidedQty || 0);
    const lineTotal = (billableQty * line.unitPrice).toFixed(2);
    
    // Wrapped name logic
    const name = line.itemName;
    let currentLine = 0;
    while (currentLine * nameWidth < name.length) {
        const namePart = name.substring(currentLine * nameWidth, (currentLine + 1) * nameWidth);
        if (currentLine === 0) {
            // First line of item includes Qty and Total
            lines.push(
                String(billableQty).padEnd(qtyWidth) + 
                namePart.padEnd(nameWidth) + 
                lineTotal.padStart(priceWidth)
            );
        } else {
            // Subsequent lines only contain the rest of the name
            lines.push(" ".repeat(qtyWidth) + namePart);
        }
        currentLine++;
    }
  });

  lines.push(hr());

  // --- TOTALS ---
  const analytics = data.analytics || {};
  lines.push(justify("SUBTOTAL", (analytics.subtotal || 0).toFixed(2)));
  if ((analytics.discountsTotal || 0) > 0) {
    lines.push(justify("DISCOUNTS", `(-${analytics.discountsTotal.toFixed(2)})`));
  }
  if ((analytics.chargesTotal || 0) > 0) {
    lines.push(justify("CHARGES", `+${analytics.chargesTotal.toFixed(2)}`));
  }
  
  lines.push(hr());
  lines.push(justify("TOTAL", `PHP ${(analytics.grandTotal || 0).toFixed(2)}`));
  lines.push(hr());

  // --- PAYMENTS ---
  const mop = analytics.mop || {};
  Object.entries(mop).forEach(([method, amount]) => {
    lines.push(justify(method.toUpperCase(), (amount as number).toFixed(2)));
  });
  lines.push(justify("TOTAL PAID", (analytics.totalPaid || 0).toFixed(2)));
  lines.push(justify("CHANGE", (analytics.change || 0).toFixed(2)));

  lines.push("");
  if (settings.footerText) lines.push(center(settings.footerText));
  lines.push(center("THANK YOU!"));
  lines.push("\n\n\n\n"); // Feed for cutter

  return lines.join("\n");
}
