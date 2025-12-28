
"use client";

import { useMemo } from "react";
import { format } from 'date-fns';
import Image from "next/image";

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
    };
    closedAt: { toDate: () => Date };
    startedByUid: string;
    verifiedByUid?: string;
};

export type BillableItem = {
    itemName: string;
    qty: number;
    unitPrice: number;
    isFree: boolean;
    lineDiscountType: 'fixed' | 'percentage';
    lineDiscountValue: number;
    notes?: string;
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

function ReceiptRow({ label, value, isBold = false, isEmphasized = false }: { label: string, value: string, isBold?: boolean, isEmphasized?: boolean }) {
    const valueClass = isEmphasized ? 'text-lg' : '';
    return (
        <div className={`flex justify-between items-baseline ${isBold ? 'font-bold' : ''} ${valueClass} receipt-section`}>
            <span>{label}</span>
            <span className="text-right">{value}</span>
        </div>
    );
}

export function ReceiptView({ data }: { data: ReceiptData }) {
    const { session, billables, payments, settings } = data;

    const groupedItems = useMemo(() => {
        const map = new Map<string, { qty: number, unitPrice: number, total: number, notes?: string, lineDiscountValue: number, lineDiscountType: 'fixed' | 'percentage' }>();
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

    const paperWidthClass = settings.paperWidth === '58mm' 
        ? 'w-[58mm]' 
        : settings.paperWidth === '80mm' 
        ? 'w-[80mm]' 
        : 'w-full max-w-2xl';

    return (
        <div data-paper-width={settings.paperWidth || '80mm'} className={`receipt-view bg-white text-black font-mono mx-auto p-3 shadow-lg ${paperWidthClass}`}>
            <header className="text-center space-y-px mb-2 receipt-section">
                {settings.logoUrl && <Image src={settings.logoUrl} alt="Logo" width={40} height={40} className="mx-auto" />}
                <h1 className="font-bold text-sm">{settings.businessName || 'Your Business'}</h1>
                <p>{settings.branchName}</p>
                <p>{settings.address}</p>
                <p>{settings.contact}</p>
                {settings.tin && <p>TIN: {settings.tin} {settings.vatType === 'VAT' ? 'VAT' : 'Non-VAT'}</p>}
            </header>

            <hr className="border-dashed border-black my-2" />

            <section className="space-y-px mb-2 receipt-section">
                <ReceiptRow label="Date:" value={format(session.closedAt.toDate(), 'MM/dd/yy HH:mm')} />
                {settings.showTableOrCustomer && (
                     <ReceiptRow 
                        label={session.sessionMode === 'alacarte' ? "Customer:" : "Table:"} 
                        value={session.sessionMode === 'alacarte' ? session.customer?.name || 'N/A' : session.tableNumber || 'N/A'}
                     />
                )}
                {settings.showCashierName && <ReceiptRow label="Cashier:" value={session.startedByUid.substring(0, 6)} />}
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
                    const discountAmount = item.lineDiscountType === 'percentage' 
                        ? item.total * (item.lineDiscountValue / 100) 
                        : item.lineDiscountValue * item.qty;

                    return (
                        <div key={key} className="receipt-item-row">
                            <div className="grid grid-cols-[20px,1fr,auto] gap-x-2">
                                <span>{item.qty}</span>
                                <span className="truncate">{name}</span>
                                <span className="text-right">{item.total.toFixed(2)}</span>
                            </div>
                             {hasDiscount && settings.showDiscountBreakdown && (
                                <div className="pl-4 text-xs flex justify-between">
                                    <span>Discount</span>
                                    <span className="text-right">- {discountAmount.toFixed(2)}</span>
                                </div>
                            )}
                            {settings.showItemNotes && item.notes && (
                                <p className="col-span-3 text-gray-600 text-xs pl-2 italic">↳ {item.notes}</p>
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
                    <ReceiptRow key={i} label={p.methodId.toUpperCase()} value={p.amount.toFixed(2)} />
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
