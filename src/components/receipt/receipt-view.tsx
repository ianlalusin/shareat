
"use client";

import { useMemo } from "react";
import { format } from 'date-fns';
import Image from "next/image";
import type { ModeOfPayment, ReceiptData } from "@/lib/types";
import { toJsDate } from "@/lib/utils/date";
import { cn } from "@/lib/utils";
import { buildReceiptModel, formatMoney } from "@/lib/printing/receiptModel";

interface ReceiptViewProps {
    data: ReceiptData | null;
    paymentMethods?: ModeOfPayment[];
    /** Paper chosen on screen; overrides settings.paperWidth so preview, browser print and native output agree. */
    paperWidth?: "58mm" | "80mm";
}

function ReceiptRow({ label, value, isBold = false, isEmphasized = false, isCurrency = false, prefix = '', suffix = '' }: { label: string, value: string | number, isBold?: boolean, isEmphasized?: boolean, isCurrency?: boolean, prefix?: string, suffix?: string }) {
    const valueClass = isEmphasized ? 'text-lg' : '';
    const formattedValue = isCurrency && typeof value === 'number'
      ? `${prefix}${(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`
      : `${prefix}${value}${suffix}`;

    return (
        <div className={`flex justify-between items-baseline ${isBold ? 'font-bold' : ''} ${valueClass} receipt-section`}>
            <span>{label}</span>
            <span className="text-right">{formattedValue}</span>
        </div>
    );
}

export function ReceiptView({ data, paymentMethods = [], paperWidth: paperWidthProp }: ReceiptViewProps) {
    const paymentMethodMap = useMemo(() => new Map(paymentMethods.map(p => [p.id, p.name])), [paymentMethods]);
    const model = useMemo(() => (data && data.session && data.settings ? buildReceiptModel(data) : null), [data]);

    if (!data || !data.session || !data.settings || !model) {
        return null;
    }
    const { session, settings, createdByUsername, store } = data;
    const paperWidth = paperWidthProp || settings.paperWidth || "80mm";

    const isRefundReceipt = model.isRefund;
    const receiptDate = toJsDate(data.receiptCreatedAt) ?? toJsDate(session.closedAt);
    const dateLabel = receiptDate ? format(receiptDate, "MM/dd/yy HH:mm") : "N/A";
    const rawCashier = createdByUsername || session.cashierName || session.startedByUid?.substring(0, 6);
    const cashierName = rawCashier && rawCashier !== "N/A" ? rawCashier : ((data as any).createdByEmail ? String((data as any).createdByEmail).split("@")[0] : "N/A");

    const getPaymentMethodName = (id: string) => {
        const fromMap = paymentMethodMap.get(id);
        if (fromMap) return fromMap;
        const found = paymentMethods.find(pm => pm.name.toLowerCase() === id.toLowerCase());
        if (found) return found.name;
        return id;
    };

    const { subtotal, discountsEffect, chargesEffect, grandTotal, taxAmount, totalPaid, change, vatableSales, vatExemptSales } = model;

    const receiptStyles: React.CSSProperties = {
        fontFamily: settings?.fontFamily || undefined,
        fontSize: settings?.fontSize ? `${settings.fontSize}px` : undefined,
    };
    
    const headerFontSize = {
        fontSize: settings?.fontSize ? `${settings.fontSize * 1.5}px` : undefined,
    };
    
    const widthClass = paperWidth === "58mm" ? "receipt-58" : "receipt-80";

    return (
        <div 
            className={cn("receipt-view bg-white text-black mx-auto p-4 shadow-lg", widthClass)}
            style={receiptStyles}
        >
            {isRefundReceipt && (
                <div className="text-center font-bold border border-black rounded px-2 py-1 mb-2 text-lg tracking-widest">
                    *** REFUND RECEIPT ***
                </div>
            )}
            <header className="text-center space-y-px mb-2 receipt-section">
                {settings.showLogo && settings.logoUrl && (
                    <div className="relative mx-auto mb-1" style={{width: `${settings.logoWidthPct || 80}%`, height: 'auto', aspectRatio: '1 / 1'}}>
                        <Image 
                            src={settings.logoUrl} 
                            alt="Logo" 
                            width={160} 
                            height={160} 
                            className="object-contain mx-auto" 
                        />
                    </div>
                )}
                <h1 className="font-bold" style={headerFontSize}>{settings.businessName || 'Your Business'}</h1>
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
                <div className="grid grid-cols-[20px,1fr,auto] gap-x-2 font-bold mb-1">
                    <span>Qty</span>
                    <span>Item</span>
                    <span className="text-right">Total</span>
                </div>
                {model.rows.map(row => (
                    <div key={row.key} className="receipt-item-row mb-1">
                        <div className="grid grid-cols-[20px,1fr,auto] gap-x-2 items-start">
                            <span>{row.qty}</span>
                            <div className="min-w-0">
                                <div className="whitespace-normal break-words leading-tight">{row.name}</div>
                                {row.modifiersText && (
                                    <div className="text-xs italic pl-2 opacity-80 break-words leading-tight">— {row.modifiersText}</div>
                                )}
                                {row.note && (
                                    <div className="text-xs italic pl-2 opacity-80 break-words leading-tight">Note: {row.note}</div>
                                )}
                                {row.freeQty > 0 && (
                                    <div className="text-xs italic pl-2 opacity-80 leading-tight">Free ({row.freeQty}x)</div>
                                )}
                            </div>
                            <span className="text-right whitespace-nowrap">{formatMoney(row.amount)}</span>
                        </div>
                        {row.discount !== 0 && settings.showDiscountBreakdown && (
                            <div className="pl-4 italic flex justify-between">
                                <span>Discount ({row.discountQty}x)</span>
                                <span className="text-right whitespace-nowrap">{formatMoney(row.discount)}</span>
                            </div>
                        )}
                    </div>
                ))}
            </section>

             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px mb-2 receipt-section">
                <ReceiptRow label="Subtotal" value={subtotal} isCurrency />
                {discountsEffect !== 0 && (
                    discountsEffect < 0
                        ? <ReceiptRow label="Discounts" value={-discountsEffect} isCurrency prefix="(- " suffix=")" />
                        : <ReceiptRow label="Discounts" value={discountsEffect} isCurrency prefix="+ " />
                )}
                {chargesEffect !== 0 && (
                    chargesEffect > 0
                        ? <ReceiptRow label="Charges" value={chargesEffect} isCurrency prefix="+ " />
                        : <ReceiptRow label="Charges" value={-chargesEffect} isCurrency prefix="(- " suffix=")" />
                )}
             </section>
             
             {(taxAmount !== 0 || vatExemptSales !== 0) && (
                 <>
                    <hr className="border-dashed border-black my-2" />
                    <section className="space-y-px mb-2 receipt-section">
                         <ReceiptRow label="VATable Sales" value={vatableSales} isCurrency />
                         <ReceiptRow label="VAT-Exempt Sales" value={vatExemptSales} isCurrency />
                         <ReceiptRow label={`VAT (${store?.taxRatePct || 12}%)`} value={taxAmount} isCurrency />
                    </section>
                </>
             )}

             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px my-2 receipt-section">
                <ReceiptRow label="TOTAL" value={grandTotal} isBold={true} isCurrency prefix="PHP " />
             </section>
            
             <hr className="border-dashed border-black my-2" />
             <section className="space-y-px mb-2 receipt-section">
                {model.payments.map((p, i) => (
                    <ReceiptRow key={i} label={getPaymentMethodName(p.methodId).toUpperCase()} value={p.amount} isCurrency />
                ))}
                 <ReceiptRow label={isRefundReceipt ? "Total Refunded" : "Total Paid"} value={totalPaid} isCurrency />
                 <ReceiptRow label="CHANGE" value={change} isBold={true} isCurrency />
             </section>

             {model.freeItems.length > 0 && (
                <>
                 <hr className="border-dashed border-black my-2" />
                 <section className="space-y-px mb-2 receipt-section">
                    <p className="font-bold">Free Items:</p>
                    {model.freeItems.map(item => (
                        <p key={item.name}>{item.qty}x {item.name}</p>
                    ))}
                 </section>
                </>
             )}

            <footer className="text-center mt-4 space-y-2 receipt-section">
                {settings.footerText && <p>{settings.footerText}</p>}
                <p>Thank you for sharelebrating with us!</p>
            </footer>
        </div>
    );
}

    