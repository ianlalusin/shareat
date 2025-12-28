
"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, X } from "lucide-react";

export type PaymentMethod = {
    id: string;
    name: string;
    type: 'cash' | 'card' | 'online' | 'other';
    hasRef?: boolean;
};

export type Payment = {
    id: string;
    methodId: string;
    amount: number;
    reference?: string;
};

interface PaymentSectionProps {
    paymentMethods: PaymentMethod[];
    payments: Payment[];
    setPayments: React.Dispatch<React.SetStateAction<Payment[]>>;
    totalPaid: number;
    remainingBalance: number;
    change: number;
    isLocked?: boolean;
}

function CurrencyInput({ value, onChange, disabled }: { value: number, onChange: (val: number) => void, disabled?: boolean }) {
    const [displayValue, setDisplayValue] = useState(value.toString());

    useEffect(() => {
        setDisplayValue(value.toString());
    }, [value]);

    const handleFocus = () => {
        if (parseFloat(displayValue) === 0) {
            setDisplayValue("");
        }
    };

    const handleBlur = () => {
        if (displayValue === "" || isNaN(parseFloat(displayValue))) {
            setDisplayValue("0");
            onChange(0);
        } else {
            onChange(parseFloat(displayValue));
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setDisplayValue(e.target.value);
    };

    const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const numVal = parseFloat(displayValue);
        if (!isNaN(numVal)) {
            onChange(numVal);
        }
    }
    
    return (
        <div className="relative">
           <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">₱</span>
           <Input 
                type="number" 
                value={displayValue}
                onChange={handleChange}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyUp={handleKeyUp}
                className="h-9 pl-7" 
                disabled={disabled}
            />
        </div>
    )
}

export function PaymentSection({ 
    paymentMethods, 
    payments, 
    setPayments,
    totalPaid,
    remainingBalance,
    change,
    isLocked = false
}: PaymentSectionProps) {
    
    const addPayment = () => {
        // Find the 'cash' payment method to use its ID as the default
        const cashMethod = paymentMethods.find(pm => pm.type === 'cash');
        const defaultMethodId = cashMethod?.id || (paymentMethods.length > 0 ? paymentMethods[0].id : '');
        
        setPayments(prev => [...prev, { id: `pay-${Date.now()}`, methodId: defaultMethodId, amount: 0, reference: '' }]);
    };

    const removePayment = (id: string) => {
        setPayments(prev => prev.filter(p => p.id !== id));
    };

    const updatePayment = (id: string, updatedValues: Partial<Payment>) => {
        setPayments(prev => prev.map(p => p.id === id ? { ...p, ...updatedValues } : p));
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Payment</CardTitle>
                <CardDescription>Record single or multiple payments.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-3">
                    {payments.map(payment => {
                        const selectedMethod = paymentMethods.find(pm => pm.id === payment.methodId);
                        return (
                        <div key={payment.id} className="grid grid-cols-1 gap-2">
                             <div className="grid grid-cols-[1fr,1fr,auto] gap-2 items-center">
                                <Select value={payment.methodId} onValueChange={(val) => updatePayment(payment.id, { methodId: val })} disabled={isLocked}>
                                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {paymentMethods.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                
                                <CurrencyInput
                                    value={payment.amount}
                                    onChange={(amount) => updatePayment(payment.id, { amount })}
                                    disabled={isLocked}
                                />

                                <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => removePayment(payment.id)} disabled={isLocked}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                            {selectedMethod?.hasRef && (
                                <Input 
                                    placeholder="Reference #"
                                    value={payment.reference || ''}
                                    onChange={(e) => updatePayment(payment.id, { reference: e.target.value })}
                                    disabled={isLocked}
                                    className="h-9"
                                />
                            )}
                        </div>
                    )})}
                </div>

                <Button variant="outline" size="sm" onClick={addPayment} className="w-full" disabled={isLocked}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Payment Line
                </Button>
                
                <div className="space-y-1 pt-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Paid</span>
                        <span className="font-medium">₱{totalPaid.toFixed(2)}</span>
                    </div>
                     <div className={`flex justify-between ${remainingBalance > 0 ? 'text-destructive' : 'text-green-600'}`}>
                        <span className="text-muted-foreground">{remainingBalance > 0 ? "Balance" : "Change"}</span>
                        <span className="font-medium">₱{(remainingBalance > 0 ? remainingBalance : change).toFixed(2)}</span>
                    </div>
                </div>

            </CardContent>
        </Card>
    );
}
