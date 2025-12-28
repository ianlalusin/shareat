
"use client";

import { useMemo } from "react";
import { format } from 'date-fns';
import Image from "next/image";

// Define types based on your Firestore structure
// These should ideally be in a shared types file
type Session = {
    id: string;
    businessName?: string;
    branchName?: string;
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
    };
    closedAt: { toDate: () => Date };
    startedByUid: string;
    verifiedByUid?: string;
};

type BillableItem = {
    itemName: string;
    qty: number;
    unitPrice: number;
    isFree: boolean;
    lineDiscountValue: number;
    lineDiscountType: 'fixed' | 'percentage';
    notes?: string;
};

type Payment = {
    methodId: string; // Should match a name from your payment methods
    amount: number;
};

type ReceiptSettings = {
    businessName?: string;
    branchName?: string;
    address?: string;
    contact?: string;
    tin?: string;
    vatType?: "VAT" | "NON_VAT";
    logoUrl?: string;
    footerText?: string;
    showCashierName?: boolean;
    showServerName?: boolean;
    showTableOrCustomer?: boolean;
    showItemNotes?: boolean;
    showDiscountBreakdown?: boolean;
    showChargeBreakdown?: boolean;
    paperWidth?: "58mm" | "80mm" | "A4";
};

export type ReceiptData = {
    session: Session;
    billables: BillableItem[];
    payments: Payment[];
    settings: ReceiptSettings;
};

function ReceiptRow({ label, value, isBold = false }: { label: string, value: string, isBold?: boolean }) {
    return (
        <div className={`flex justify-between ${isBold ? 'font-bold' : ''}`}>
            <span>{label}</span>
            <span>{value}</span>
        </div>
    );
}

export function ReceiptView({ data }: { data: ReceiptData }) {
    const { session, billables, payments, settings } = data;

    const groupedItems = useMemo(() => {
        const map = new Map<string, { qty: number, total: number, notes?: string }>();
        billables.forEach(item => {
            if (item.isFree) return; // Exclude free items from paid summary
            const key = `${item.itemName}@${item.unitPrice.toFixed(2)}`;
            const existing = map.get(key);
            if (existing) {
                existing.qty += item.qty;
                existing.total += item.qty * item.unitPrice;
            } else {
                map.set(key, { qty: item.qty, total: item.qty * item.unitPrice, notes: item.notes });
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

    const paperWidthClass = settings.paperWidth === '58mm' ? 'w-[54mm]' : 'w-[76mm]';

    return (
        <div className={`bg-white text-black font-mono text-xs mx-auto p-2 shadow-lg ${paperWidthClass} print:shadow-none print:mx-0 print:p-0`}>
            <style jsx global>{`
                @media print {
                    body {
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    @page {
                        size: auto;
                        margin: 0mm;
                    }
                    .print-container {
                         margin: 0;
                         padding: 0;
                         width: 100%;
                    }
                }
            `}</style>
            
            <header className="text-center space-y-px mb-2">
                {settings.logoUrl && <Image src={settings.logoUrl} alt="Logo" width={40} height={40} className="mx-auto" />}
                <h1 className="font-bold">{settings.businessName || 'Your Business'}</h1>
                <p>{settings.branchName}</p>
                <p>{settings.address}</p>
                <p>{settings.contact}</p>
                {settings.tin && <p>TIN: {settings.tin} {settings.vatType === 'VAT' ? 'VAT Registered' : 'Non-VAT'}</p>}
            </header>

            <hr className="border-dashed border-black my-2" />

            <section className="space-y-px text-xs mb-2">
                <ReceiptRow label="Date:" value={format(session.closedAt.toDate(), 'MM/dd/yyyy HH:mm')} />
                {settings.showTableOrCustomer && (
                     <ReceiptRow 
                        label={session.sessionMode === 'alacarte' ? "Customer:" : "Table:"} 
                        value={session.sessionMode === 'alacarte' ? session.customer?.name || 'N/A' : session.tableNumber || 'N/A'}
                     />
                )}
                {/* TODO: Add cashier/server names from user profiles */}
                {settings.showCashierName && <ReceiptRow label="Cashier:" value={session.startedByUid.substring(0, 6)} />}
            </section>

            <hr className="border-dashed border-black my-2" />

            {/* Items */}
            <section className="mb-2">
                <div className="grid grid-cols-[20px,1fr,50px] gap-x-1 font-bold">
                    <span>QTY</span>
                    <span>ITEM</span>
                    <span className="text-right">TOTAL</span>
                </div>
                {groupedItems.map(([key, item]) => {
                    const [name] = key.split('@');
                    return (
                        <div key={key} className="grid grid-cols-[20px,1fr,50px] gap-x-1">
                            <span>{item.qty}</span>
                            <span>{name}</span>
                            <span className="text-right">{item.total.toFixed(2)}</span>
                            {settings.showItemNotes && item.notes && (
                                <p className="col-span-3 text-gray-600 text-xs pl-2 italic">↳ {item.notes}</p>
                            )}
                        </div>
                    );
                })}
            </section>

            {/* Subtotal & Discounts */}
             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px mb-2">
                <ReceiptRow label="Subtotal" value={session.paymentSummary.subtotal.toFixed(2)} />
                {settings.showDiscountBreakdown && (session.paymentSummary.lineDiscountsTotal > 0 || session.paymentSummary.billDiscountAmount > 0) && (
                    <ReceiptRow label="Discounts" value={`-${(session.paymentSummary.lineDiscountsTotal + session.paymentSummary.billDiscountAmount).toFixed(2)}`} />
                )}
                 {settings.showChargeBreakdown && session.paymentSummary.adjustmentsTotal > 0 && (
                    <ReceiptRow label="Charges" value={session.paymentSummary.adjustmentsTotal.toFixed(2)} />
                )}
             </section>

             {/* Total */}
             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px mb-2">
                <ReceiptRow label="GRAND TOTAL" value={`P ${session.paymentSummary.grandTotal.toFixed(2)}`} isBold={true} />
             </section>
            
             {/* Payments */}
             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px mb-2">
                {payments.map((p, i) => (
                    <ReceiptRow key={i} label={p.methodId} value={p.amount.toFixed(2)} />
                ))}
                 <ReceiptRow label="TOTAL PAID" value={session.paymentSummary.totalPaid.toFixed(2)} />
                 <ReceiptRow label="CHANGE" value={session.paymentSummary.change.toFixed(2)} />
             </section>

             {freeItems.length > 0 && (
                <>
                 <hr className="border-dashed border-black my-2" />
                 <section className="space-y-px mb-2">
                    <p className="font-bold">FREE ITEMS:</p>
                    {freeItems.map(([name, item]) => (
                        <p key={name}>{item.qty}x {name}</p>
                    ))}
                 </section>
                </>
             )}

            <footer className="text-center mt-4 space-y-px">
                {settings.footerText && <p>{settings.footerText}</p>}
                <p>Thank you!</p>
            </footer>
        </div>
    );
}
