

"use client";

import { useMemo } from "react";
import { format } from 'date-fns';
import Image from "next/image";
import { Timestamp } from "firebase/firestore";
import type { ModeOfPayment, SessionBillLine, Store } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";

// Define types based on your Firestore structure
export type Session = {
    id: string;
    tableNumber?: string;
    customer?: { name?: string };
    customerName?: string | null;
    sessionMode: 'package_dinein' | 'alacarte';
    guestCountFinal?: number; // Added to ensure it's available
    paymentSummary: {
        subtotal: number;
        lineDiscountsTotal: number;
        billDiscountAmount: number;
        adjustmentsTotal: number;
        grandTotal: number;
        totalPaid: number;
        change: number;
        printedCount?: number;
    };
    closedAt: Timestamp | { toDate: () => Date } | Date | { seconds: number, nanoseconds: number };
    startedByUid: string;
    verifiedByUid?: string;
    cashierName?: string;
};

export type Payment = {
    methodId: string;
    amount: number;
};

export type ReceiptSettings = {
    businessName?: string;
    branchName?: string;
    address?: string;
    contact?: string;
    tin?: string;
    vatType?: "VAT" | "NON_VAT";
    logoUrl?: string;
    footerText?: string;
    showCashierName?: boolean;
    showTableOrCustomer?: boolean;
    showItemNotes?: boolean;
    showDiscountBreakdown?: boolean;
    showChargeBreakdown?: boolean;
    paperWidth?: "58mm" | "80mm" | "A4";
    receiptNoFormat?: string;
};

export type ReceiptData = {
    session: Session;
    lines?: SessionBillLine[]; // New counter model
    payments: Payment[];
    settings: ReceiptSettings;
    store?: Store, // Pass the full store object for tax calculation
    receiptCreatedAt?: any;
    createdByUsername?: string;
    receiptNumber?: string;
    analytics?: any;
};

interface ReceiptViewProps {
    data: ReceiptData | null;
    paymentMethods?: ModeOfPayment[];
    forcePaperWidth?: "58mm" | "80mm" | "A4";
}

function ReceiptRow({ label, value, isBold = false, isEmphasized = false, isCurrency = false, prefix = '' }: { label: string, value: string | number, isBold?: boolean, isEmphasized?: boolean, isCurrency?: boolean, prefix?: string }) {
    const valueClass = isEmphasized ? 'text-lg' : '';
    const formattedValue = isCurrency && typeof value === 'number'
      ? `${prefix}${(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : value;
    return (
        <div className={`flex justify-between items-baseline ${isBold ? 'font-bold' : ''} ${valueClass} receipt-section`}>
            <span>{label}</span>
            <span className="text-right">{formattedValue}</span>
        </div>
    );
}

export function ReceiptView({ data, paymentMethods = [], forcePaperWidth }: ReceiptViewProps) {
    if (!data || !data.session) {
        return null;
    }
    const { session, lines, settings, createdByUsername, store } = data;
    const paperWidth = forcePaperWidth || settings.paperWidth || "80mm";
    const analytics = data.analytics || {};

    const paymentMethodMap = useMemo(() => new Map(paymentMethods.map(p => [p.id, p.name])), [paymentMethods]);

    const activeLines = useMemo(() => (lines || []).filter(line => (line.qtyOrdered - (line.voidedQty || 0)) > 0), [lines]);

    const freeItems = useMemo(() => {
        const map = new Map<string, { qty: number }>();
        (lines || []).forEach(item => {
            if (item.freeQty > 0) {
                 const key = item.itemName;
                 const existing = map.get(key);
                 if (existing) existing.qty += item.freeQty;
                 else map.set(key, { qty: item.freeQty });
            }
        });
        return Array.from(map.entries());
    }, [lines]);

    const receiptDate = toJsDate(data.receiptCreatedAt) ?? toJsDate(session.closedAt);
    const dateLabel = receiptDate ? format(receiptDate, "MM/dd/yy HH:mm") : "N/A";
    const cashierName = createdByUsername || session.cashierName || session.startedByUid?.substring(0, 6) || "N/A";

    const getPaymentMethodName = (id: string) => {
        const fromMap = paymentMethodMap.get(id);
        if (fromMap) return fromMap;

        // Fallback for when `payments` in analytics is just a map of names to amounts
        const found = paymentMethods.find(pm => pm.name.toLowerCase() === id.toLowerCase());
        if (found) return found.name;

        return id;
    };
    
    // Use analytics totals directly
    const { 
        subtotal = 0,
        discountsTotal = 0,
        chargesTotal = 0,
        grandTotal = 0,
        taxAmount = 0,
        totalPaid = 0,
        change = 0,
        mop = {}
    } = analytics;

    const paymentsFromAnalytics = Object.entries(mop).map(([methodId, amount]) => ({ methodId, amount: amount as number }));
    const vatableSales = grandTotal - taxAmount;

    return (
        <div data-paper-width={paperWidth} className="receipt-view bg-white text-black font-mono mx-auto p-4 shadow-lg">
            <header className="text-center space-y-px mb-2 receipt-section">
                {settings.logoUrl && <Image src={settings.logoUrl} alt="Logo" width={40} height={40} className="mx-auto" />}
                <h1 className="font-bold text-sm">{settings.businessName || 'Your Business'}</h1>
                <p>{settings.address}</p>
                <p>{settings.contact}</p>
                {settings.tin && <p>TIN: {settings.tin} {settings.vatType === 'VAT' ? 'VAT' : 'Non-VAT'}</p>}
            </header>

            <hr className="border-dashed border-black my-2" />

            <section className="space-y-px mb-2 receipt-section">
                <ReceiptRow label="Date:" value={dateLabel} />
                <ReceiptRow label="Receipt:" value={data.receiptNumber ?? "—"} />
                {settings.showTableOrCustomer && (
                     <ReceiptRow 
                        label={session.sessionMode === 'alacarte' ? "Customer:" : "Table:"} 
                        value={session.sessionMode === 'alacarte' ? (session.customer?.name || session.customerName || 'N/A') : session.tableNumber || 'N/A'}
                     />
                )}
                {settings.showCashierName && <ReceiptRow label="Cashier:" value={cashierName} />}
            </section>

            <hr className="border-dashed border-black my-2" />

            <section className="mb-2 receipt-section">
                <div className="grid grid-cols-[20px,1fr,auto] gap-x-2 font-bold">
                    <span>Qty</span>
                    <span>Item</span>
                    <span className="text-right">Total</span>
                </div>
                {activeLines.map(line => {
                    const billableQty = line.qtyOrdered - (line.voidedQty || 0);
                    const lineTotal = billableQty * line.unitPrice;
                    
                    const hasDiscount = (line.discountValue ?? 0) > 0 && line.discountQty > 0;
                    
                    let lineDiscountAmount = 0;
                    if (hasDiscount && store) {
                        const taxRate = (store.taxRatePct || 0) / 100;
                        const isVatInclusive = store.taxType === "VAT_INCLUSIVE";
                        const discountedQty = Math.min(line.discountQty, billableQty);
                        
                        const discountBaseUnit = isVatInclusive && taxRate > 0
                          ? (line.unitPrice / (1 + taxRate))
                          : line.unitPrice;

                        if (line.discountType === "percent") {
                           lineDiscountAmount = (discountedQty * discountBaseUnit) * (line.discountValue! / 100);
                        } else { // fixed
                           lineDiscountAmount = Math.min(discountBaseUnit, (line.discountValue ?? 0)) * discountedQty;
                        }
                    }

                    return (
                        <div key={line.id} className="receipt-item-row">
                             <div className="grid grid-cols-[20px,1fr,auto] gap-x-2 items-start">
                                <span>{billableQty}</span>
                                <div className="min-w-0">
                                  <div className="whitespace-normal break-words leading-tight">
                                    {line.itemName}
                                  </div>
                                </div>
                                <span className="text-right whitespace-nowrap">
                                  {lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                             {hasDiscount && settings.showDiscountBreakdown && (
                                <div className="pl-4 text-xs flex justify-between">
                                    <span>Discount ({line.discountQty}x)</span>
                                    <span className="text-right whitespace-nowrap">- {lineDiscountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </section>

             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px mb-2 text-xs receipt-section">
                <ReceiptRow label="Subtotal" value={subtotal} isCurrency />
                {(discountsTotal > 0) && (
                    <ReceiptRow label="Discounts" value={discountsTotal} isCurrency prefix="(- " suffix=")" />
                )}
                 {(chargesTotal > 0) && (
                    <ReceiptRow label="Charges" value={chargesTotal} isCurrency prefix="+ " />
                )}
             </section>
             
             {(taxAmount > 0) && (
                 <>
                    <hr className="border-dashed border-black my-2" />
                    <section className="space-y-px mb-2 text-xs receipt-section">
                         <ReceiptRow label="VATable Sales" value={vatableSales} isCurrency />
                         <ReceiptRow label="VAT Exempt Sales" value={0} isCurrency />
                         <ReceiptRow label={`VAT (${store?.taxRatePct || 12}%)`} value={taxAmount} isCurrency />
                    </section>
                </>
             )}


             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px my-2 receipt-section">
                <ReceiptRow label="TOTAL" value={grandTotal} isBold={true} isEmphasized={true} isCurrency prefix="PHP " />
             </section>
            
             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px mb-2 text-xs receipt-section">
                {paymentsFromAnalytics.map((p, i) => (
                    <ReceiptRow key={i} label={getPaymentMethodName(p.methodId).toUpperCase()} value={p.amount} isCurrency />
                ))}
                 <ReceiptRow label="Total Paid" value={totalPaid} isCurrency />
                 <ReceiptRow label="CHANGE" value={change} isBold={true} isEmphasized={true} isCurrency />
             </section>

             {freeItems.length > 0 && (
                <>
                 <hr className="border-dashed border-black my-2" />
                 <section className="space-y-px mb-2 receipt-section">
                    <p className="font-bold">FREE ITEMS:</p>
                    {freeItems.map(([name, item]) => (
                        <p key={name} className="text-xs">{item.qty}x {name}</p>
                    ))}
                 </section>
                </>
             )}

            <footer className="text-center mt-4 space-y-2 receipt-section">
                {settings.footerText && <p className="text-xs">{settings.footerText}</p>}
                <p className="text-xs">Thank you!</p>
            </footer>
        </div>
    );
}
