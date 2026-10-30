'use client';

import { toJsDate } from "@/lib/utils/date";
import type { ReceiptData } from "@/lib/types";
import { format } from "date-fns";
import { buildReceiptModel, formatMoney, isRefundReceipt } from "./receiptModel";

/** "(-20.00)" for a reduction, "+20.00" for an addition. */
const signed = (n: number) => (n < 0 ? `(-${formatMoney(-n)})` : `+${formatMoney(n)}`);

/**
 * Formats receipt data into plain text for thermal printing (ESC/POS).
 */
export function formatReceiptText(
  data: ReceiptData,
  width: 58 | 80 = 80,
  fontMode: 'small' | 'normal' | 'large' = 'normal',
): string {
  // Thermal fonts: Font A (normal) and the denser Font B (small) fit a
  // different number of columns per line. "large" is Font A at double height —
  // the character WIDTH is unchanged, so it uses the same columns as normal.
  const charsPerLine =
    fontMode === 'small' ? (width === 58 ? 42 : 64) : (width === 58 ? 32 : 48);
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
  if (isRefundReceipt(data as any)) {
    lines.push(center("*** REFUND RECEIPT ***"));
    lines.push("");
  }
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

  // Same row model as the browser ReceiptView: modifiers once, free units not
  // billed, refund rows negative — so the item rows sum to SUBTOTAL.
  const model = buildReceiptModel(data);
  const indent = ' '.repeat(qtyWidth);
  const wrap = (text: string, width: number): string[] => {
    const out: string[] = [];
    for (let rest = text; rest.length > 0; rest = rest.slice(width)) out.push(rest.slice(0, width));
    return out.length ? out : [''];
  };
  model.rows.forEach(row => {
    const nameLines = wrap(row.name, nameWidth - 1);
    lines.push(String(row.qty).padEnd(qtyWidth) + nameLines[0].padEnd(nameWidth) + formatMoney(row.amount).padStart(priceWidth));
    nameLines.slice(1).forEach(l => lines.push(indent + l));
    const subWidth = charsPerLine - qtyWidth - 2;
    if (row.modifiersText) wrap('- ' + row.modifiersText, subWidth).forEach(l => lines.push(indent + '  ' + l));
    if (row.note) wrap('Note: ' + row.note, subWidth).forEach(l => lines.push(indent + '  ' + l));
    if (row.freeQty > 0) lines.push(indent + '  ' + `Free (${row.freeQty}x)`);
    if (row.discount !== 0 && settings.showDiscountBreakdown) {
      lines.push(justify(indent + '  ' + `Discount (${row.discountQty}x)`, formatMoney(row.discount)));
    }
  });

  lines.push(hr());

  lines.push(justify("SUBTOTAL", formatMoney(model.subtotal)));
  if (model.discountsEffect !== 0) {
    lines.push(justify("DISCOUNTS", signed(model.discountsEffect)));
  }
  if (model.chargesEffect !== 0) {
    lines.push(justify("CHARGES", signed(model.chargesEffect)));
  }

  if (model.taxAmount !== 0 || model.vatExemptSales !== 0) {
    lines.push(hr());
    lines.push(justify("VATABLE SALES", formatMoney(model.vatableSales)));
    lines.push(justify("VAT-EXEMPT SALES", formatMoney(model.vatExemptSales)));
    lines.push(justify(`VAT (${data.store?.taxRatePct || 12}%)`, formatMoney(model.taxAmount)));
  }

  lines.push(hr());
  lines.push(justify("TOTAL", `PHP ${formatMoney(model.grandTotal)}`));
  lines.push(hr());

  model.payments.forEach(({ methodId, amount }) => {
    lines.push(justify(methodId.toUpperCase(), formatMoney(amount)));
  });
  lines.push(justify(model.isRefund ? "TOTAL REFUNDED" : "TOTAL PAID", formatMoney(model.totalPaid)));
  lines.push(justify("CHANGE", formatMoney(model.change)));

  if (model.freeItems.length > 0) {
    lines.push(hr());
    lines.push("FREE ITEMS:");
    model.freeItems.forEach(f => lines.push(`${f.qty}x ${f.name}`));
  }

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

export function formatSharelebratorPasswordText(opts: {
  name: string;
  phone: string;
  tempPassword: string;
  resetAtMs?: number;
  width: 58 | 80;
}): string {
  const charsPerLine = opts.width === 58 ? 32 : 38;
  const center = (text: string) => text.trim();
  const hr = () => '-'.repeat(charsPerLine);
  const dashed = () => '='.repeat(charsPerLine);

  const lines: string[] = [
    center('* SHARELEBRATOR *'),
    center('Password Reset'),
    hr(),
    '',
    center('Cardholder:'),
    center(opts.name),
    '',
    center('Phone:'),
    center(opts.phone),
    '',
    dashed(),
    center('TEMPORARY PASSWORD'),
    '',
    center(opts.tempPassword),
    '',
    dashed(),
    '',
    center('Use this to log in to your'),
    center('Sharelebrator account.'),
    center('Please change it after login.'),
    '',
    hr(),
    center(new Date(opts.resetAtMs ?? Date.now()).toLocaleString()),
    '\n\n\n\n',
  ];

  return lines.join('\n');
}

export function formatPinText(opts: {
  pin: string;
  customerName?: string | null;
  storeName?: string;
  width: 58 | 80;
  qrPosition?: "top" | "middle" | "bottom";
  /** Table the slip belongs to ("Table 3"); printed as its own bold line under the greeting. */
  tableLabel?: string | null;
}): PinTextParts {
  const qrPos = opts.qrPosition ?? 'middle';

  // No software centering — printer handles alignment via ESC a 01
  const center = (text: string) => text.trim();

  // Line markup read by the native plugin (writePinSlipLines): a "**" prefix prints
  // the line bold, and a line of exactly 6 uppercase letters/digits is the PIN
  // (bold, double size). Every line here is ≤32 chars, so none wraps on 58mm.
  let tableLine: string | null = null;
  const rawTable = (opts.tableLabel ?? '').trim().slice(0, 32).trim();
  if (rawTable) {
    // A label that is exactly 6 uppercase letters/digits would be printed by the plugin
    // as the PIN (double size), so give it a prefix that can never match.
    const safe = /^[A-Z0-9]{6}$/.test(rawTable) ? ('Table ' + rawTable).slice(0, 32) : rawTable;
    tableLine = '**' + center(safe);
  }

  const headerLines: string[] = [
    ...(opts.customerName ? [center('Welcome ' + opts.customerName + ',')] : [center('Welcome,')]),
    ...(tableLine ? [tableLine] : []),
    '',
    center('Scan the QR code or go to'),
    '**' + center('CUSTOMER.SHAREAT.NET'),
    center('and enter this PIN to access'),
    center('our smart refilling system.'),
    '',
  ];

  const footerLines: string[] = [
    '',
    center(opts.pin),
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