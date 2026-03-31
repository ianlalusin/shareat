'use client';

import { toJsDate } from "@/lib/utils/date";
import type { ReceiptData, SessionBillLine } from "@/lib/types";
import { format } from "date-fns";

/**
 * Formats receipt data into plain text for thermal printing (ESC/POS).
 */
export function formatReceiptText(data: ReceiptData, width: 58 | 80 = 80): string {
  const charsPerLine = width === 58 ? 32 : 48;
  const qtyWidth = 4;
  const priceWidth = 10;
  const nameWidth = charsPerLine - qtyWidth - priceWidth;
  const lines: string[] = [];

  const center = (text: string) => {
    const padding = Math.max(0, Math.floor((charsPerLine - text.length) / 2));
    return " ".repeat(padding) + text;
  };
  const justify = (left: string, right: string) => {
    const space = charsPerLine - left.length - right.length;
    return left + " ".repeat(Math.max(1, space)) + right;
  };
  const hr = () => "-".repeat(charsPerLine);

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

  const headerRow = 'Qty'.padEnd(qtyWidth) + 'Item'.padEnd(nameWidth) + 'Total'.padStart(priceWidth);
  lines.push(headerRow);

  const activeLines = (data.lines || []).filter(l => (l.qtyOrdered - (l.voidedQty || 0)) > 0);
  activeLines.forEach(line => {
    const billableQty = line.qtyOrdered - (line.voidedQty || 0);
    const lineTotal = (billableQty * line.unitPrice).toFixed(2);
    const name = line.itemName.substring(0, nameWidth - 1);
    lines.push(String(billableQty).padEnd(qtyWidth) + name.padEnd(nameWidth) + lineTotal.padStart(priceWidth));
  });

  lines.push(hr());

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

  const mop = analytics.mop || {};
  Object.entries(mop).forEach(([method, amount]) => {
    lines.push(justify(method.toUpperCase(), (amount as number).toFixed(2)));
  });
  lines.push(justify("TOTAL PAID", (analytics.totalPaid || 0).toFixed(2)));
  lines.push(justify("CHANGE", (analytics.change || 0).toFixed(2)));

  lines.push("");
  if (settings.footerText) lines.push(center(settings.footerText));
  lines.push(center("THANK YOU!"));
  lines.push("\n\n\n\n");

  return lines.join("\n");
}

/**
 * PIN slip split into top/bottom halves around a QR code.
 * top    → printed before QR
 * bottom → printed after QR
 */
export interface PinTextParts {
  top: string;
  bottom: string;
}

export function formatPinText(opts: {
  pin: string;
  customerName?: string | null;
  storeName?: string;
  width: 58 | 80;
  qrPosition?: "top" | "middle" | "bottom";
}): PinTextParts {
  const charsPerLine = opts.width === 58 ? 32 : 42;
  const qrPos = opts.qrPosition ?? 'middle';

  const center = (text: string) => {
    const pad = Math.max(0, Math.floor((charsPerLine - text.length) / 2));
    return ' '.repeat(pad) + text;
  };
  const hr = () => '-'.repeat(charsPerLine);

  const headerLines: string[] = [
    ...(opts.customerName ? [center('Welcome ' + opts.customerName + ',')] : [center('Welcome,')]),
    '',
    center('We are glad you are here to'),
    center('SHARELEBRATE'),
    center('with us.'),
    '',
    center('Scan the code below or go to'),
    center('customer.shareat.net'),
    center('then enter your PIN and enjoy'),
    center('our new refilling system.'),
    '',
  ];

  const footerLines: string[] = [
    '',
    hr(),
    center('YOUR PIN'),
    center(opts.pin),
    hr(),
    '',
    center('If you need help, call our staff.'),
    center('Have a nice stay!'),
    '',
    center(`- ${opts.storeName || 'The SharEat Team'}`),
    '\n\n\n\n',
  ];

  let topLines: string[];
  let bottomLines: string[];

  if (qrPos === 'top') {
    topLines = [];
    bottomLines = [...headerLines, ...footerLines];
  } else if (qrPos === 'bottom') {
    topLines = [...headerLines, ...footerLines];
    bottomLines = [];
  } else {
    // middle (default)
    topLines = headerLines;
    bottomLines = footerLines;
  }

  return { top: topLines.join('\n'), bottom: bottomLines.join('\n') };
}