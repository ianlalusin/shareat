

"use client";

import { useMemo } from "react";
import { format } from 'date-fns';
import Image from "next/image";
import { Timestamp } from "firebase/firestore";
import type { BillableItem, ModeOfPayment } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";

// Define types based on your Firestore structure
export type Session = {
    id: string;
    tableNumber?: string;
    customer?: { name?: string };
    sessionMode: 'package_dinein' | 'alacarte';
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
    billables: BillableItem[];
    payments: Payment[];
    settings: ReceiptSettings;
    receiptCreatedAt?: any;
    createdByUsername?: string;
    receiptNumber?: string;
};

interface ReceiptViewProps {
    data: ReceiptData;
    paymentMethods?: ModeOfPayment[];
    forcePaperWidth?: "58mm" | "80mm" | "A4";
}

function ReceiptRow({ label, value, isBold = false, isEmphasized = false }: { label: string, value: string, isBold?: boolean, isEmphasized?: boolean }) {
    const valueClass = isEmphasized ? 'text-lg' : '';
    return (
        <div className={`flex justify-between items-baseline ${isBold ? 'font-bold' : ''} ${valueClass} receipt-section`}>
            <span>{label}</span>
            <span className="text-right">{value}</span>
        </div>
    );
}

export function ReceiptView({ data, paymentMethods = [], forcePaperWidth }: ReceiptViewProps) {
    const { session, billables, payments, settings, createdByUsername } = data;
    const paperWidth = forcePaperWidth || settings.paperWidth || "80mm";

    const paymentMethodMap = useMemo(() => new Map(paymentMethods.map(p => [p.id, p.name])), [paymentMethods]);

    const groupedItems = useMemo(() => {
        const map = new Map<string, { qty: number, unitPrice: number, total: number, notes?: string, lineDiscountValue: number, lineDiscountType: 'fixed' | 'percent' }>();
        billables.forEach(item => {
            if (item.isFree) return;
            const key = `${item.itemName}@${item.unitPrice.toFixed(2)}`;
            const existing = map.get(key);
            if (existing) {
                existing.qty += item.qty;
                existing.total += item.qty * item.unitPrice;
            } else {
                map.set(key, { 
                    qty: item.qty, 
                    unitPrice: item.unitPrice, 
                    total: item.qty * item.unitPrice, 
                    notes: item.notes,
                    lineDiscountValue: item.lineDiscountValue,
                    lineDiscountType: item.lineDiscountType,
                });
            }
        });
        return Array.from(map.entries());
    }, [billables]);

    const freeItems = useMemo(() => {
        const map = new Map<string, { qty: number }>();
        billables.filter(i => i.isFree).forEach(item => {
             const key = item.itemName;
             const existing = map.get(key);
             if (existing) existing.qty += item.qty;
             else map.set(key, { qty: item.qty });
        });
        return Array.from(map.entries());
    }, [billables]);

    const receiptDate = toJsDate(data.receiptCreatedAt) ?? toJsDate(session.closedAt);
    const dateLabel = receiptDate ? format(receiptDate, "MM/dd/yy HH:mm") : "N/A";
    const cashierName = createdByUsername || session.cashierName || session.startedByUid.substring(0, 6);

    const getPaymentMethodName = (id: string) => {
        // Simple check if the ID is a long alphanumeric string (likely a Firestore ID)
        const isFirestoreId = id.length > 15 && /[a-zA-Z]/.test(id) && /\d/.test(id);
        if (isFirestoreId) {
            return paymentMethodMap.get(id) || id; // Fallback to ID if not found
        }
        return id; // Assume it's already a name
    };


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
                        value={session.sessionMode === 'alacarte' ? session.customer?.name || 'N/A' : session.tableNumber || 'N/A'}
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
                {groupedItems.map(([key, item]) => {
                    const [name] = key.split('@');
                    const hasDiscount = item.lineDiscountValue > 0;
                    const discountAmount = item.lineDiscountType === 'percent' 
                        ? item.total * (item.lineDiscountValue / 100) 
                        : item.lineDiscountValue * item.qty;

                    return (
                        <div key={key} className="receipt-item-row">
                             <div className="grid grid-cols-[20px,1fr,auto] gap-x-2 items-start">
                                <span>{item.qty}</span>
                                <div className="min-w-0">
                                  <div className="whitespace-normal break-words leading-tight">
                                    {name}
                                  </div>
                                  {settings.showItemNotes && item.notes && (
                                    <div className="text-gray-600 text-xs italic mt-0.5">
                                      ↳ {item.notes}
                                    </div>
                                  )}
                                </div>
                                <span className="text-right whitespace-nowrap">
                                  {item.total.toFixed(2)}
                                </span>
                            </div>
                             {hasDiscount && settings.showDiscountBreakdown && (
                                <div className="pl-4 text-xs flex justify-between">
                                    <span>Discount</span>
                                    <span className="text-right whitespace-nowrap">- {discountAmount.toFixed(2)}</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </section>

             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px mb-2 text-xs receipt-section">
                <ReceiptRow label="Subtotal" value={session.paymentSummary.subtotal.toFixed(2)} />
                {(session.paymentSummary.lineDiscountsTotal > 0 || session.paymentSummary.billDiscountAmount > 0) && (
                    <ReceiptRow label="Discounts" value={`(${(session.paymentSummary.lineDiscountsTotal + session.paymentSummary.billDiscountAmount).toFixed(2)})`} />
                )}
                 {session.paymentSummary.adjustmentsTotal > 0 && (
                    <ReceiptRow label="Charges" value={session.paymentSummary.adjustmentsTotal.toFixed(2)} />
                )}
             </section>

             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px my-2 receipt-section">
                <ReceiptRow label="TOTAL" value={`PHP ${session.paymentSummary.grandTotal.toFixed(2)}`} isBold={true} isEmphasized={true} />
             </section>
            
             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px mb-2 text-xs receipt-section">
                {payments.map((p, i) => (
                    <ReceiptRow key={i} label={getPaymentMethodName(p.methodId).toUpperCase()} value={p.amount.toFixed(2)} />
                ))}
                 <ReceiptRow label="Total Paid" value={session.paymentSummary.totalPaid.toFixed(2)} />
                 <ReceiptRow label="CHANGE" value={session.paymentSummary.change.toFixed(2)} isBold={true} isEmphasized={true} />
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

            <footer className="text-center mt-4 space-y-px receipt-section">
                {settings.footerText && <p className="text-xs">{settings.footerText}</p>}
                <p className="text-xs">Thank you!</p>
            </footer>
        </div>
    );
}
