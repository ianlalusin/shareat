
"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Check, Percent, Tag, Trash2, X } from "lucide-react";
import { type StoreDiscount, type Charge } from "@/app/cashier/page";
import { cn } from "@/lib/utils";
import { Separator } from "../ui/separator";

export type Adjustment = {
  id: string;
  note: string;
  amount: number;
  source: 'charge' | 'custom';
  sourceId?: string;
};

interface BillAdjustmentsProps {
  adjustments: Adjustment[];
  billDiscount: StoreDiscount | null;
  charges: Charge[];
  discounts: StoreDiscount[];
  onAddAdjustment: (charge: Charge) => void;
  onAddCustomAdjustment: (note: string, amount: number) => void;
  onRemoveAdjustment: (id: string) => void;
  onSetBillDiscount: (discount: StoreDiscount | null) => void;
  isLocked?: boolean;
}

type EditorMode = 'discount' | 'charge' | null;

function CurrencyInput({ value, onChange, disabled }: { value: number, onChange: (val: number) => void, disabled?: boolean }) {
    const [displayValue, setDisplayValue] = useState(value.toString());

    useEffect(() => {
        if (document.activeElement?.id !== `currency-input-${value}`) {
            setDisplayValue(value.toString());
        }
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

    const handleKeyUp = () => {
        const numVal = parseFloat(displayValue);
        if (!isNaN(numVal)) {
            onChange(numVal);
        }
    }
    
    return (
        <Input 
            id={`currency-input-${value}`}
            type="number" 
            placeholder="Value"
            value={displayValue}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyUp={handleKeyUp}
            className="h-9"
            disabled={disabled}
        />
    )
}

const EditorPanel = ({
    title,
    children,
    onClose,
}: {
    title: string;
    children: React.ReactNode;
    onClose: () => void;
}) => (
    <div className="p-3 border rounded-lg bg-background/50 space-y-3 relative">
         <Button variant="ghost" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={onClose}><X size={16} /></Button>
        <p className="text-sm font-medium">{title}</p>
        {children}
    </div>
);

function normalizeDiscountType(t: any): "fixed" | "percentage" {
    if (t === "percentage" || t === "percent") return "percentage";
    return "fixed";
}


export function BillAdjustments({
  adjustments,
  billDiscount,
  charges,
  discounts,
  onAddAdjustment,
  onAddCustomAdjustment,
  onRemoveAdjustment,
  onSetBillDiscount,
  isLocked = false,
}: BillAdjustmentsProps) {
  const [mode, setMode] = useState<EditorMode>(null);

  // State for the discount editor
  const [isCustomDiscount, setIsCustomDiscount] = useState(true);
  const [selectedDiscountId, setSelectedDiscountId] = useState<string>('custom');
  const [tempDiscountType, setTempDiscountType] = useState<'fixed' | 'percentage'>('fixed');
  const [tempDiscountValue, setTempDiscountValue] = useState(0);

  // State for custom charge
  const [showCustomCharge, setShowCustomCharge] = useState(false);
  const [customChargeNote, setCustomChargeNote] = useState("");
  const [customChargeAmount, setCustomChargeAmount] = useState(0);

  useEffect(() => {
      if (billDiscount) {
          const isSaved = discounts.some(d => d.id === billDiscount.id);
          setIsCustomDiscount(!isSaved);
          setSelectedDiscountId(isSaved ? billDiscount.id : 'custom');
          setTempDiscountType(normalizeDiscountType(billDiscount.type));
          setTempDiscountValue(billDiscount.value);
      } else {
          setIsCustomDiscount(true);
          setSelectedDiscountId('custom');
          setTempDiscountType('fixed');
          setTempDiscountValue(0);
      }
  }, [billDiscount, discounts]);

  const handleDiscountSelect = (id: string) => {
    setSelectedDiscountId(id);
    if (id === 'custom') {
        setIsCustomDiscount(true);
        setTempDiscountType('fixed');
        setTempDiscountValue(0);
    } else {
        const selected = discounts.find(d => d.id === id);
        if (selected) {
            setIsCustomDiscount(false);
            setTempDiscountType(normalizeDiscountType(selected.type));
            setTempDiscountValue(Number(selected.value) || 0);
        }
    }
  }

  const handleApplyDiscount = () => {
    let discountToApply: StoreDiscount;
    if (isCustomDiscount) {
         discountToApply = {
            id: `custom-${Date.now()}`,
            name: 'Custom Discount',
            type: tempDiscountType,
            value: tempDiscountValue,
            scope: 'bill',
            stackable: false, isEnabled: true, sortOrder: 9999, isArchived: false, createdAt: '', updatedAt: '', createdBy: '', updatedBy: ''
        };
    } else {
        const selected = discounts.find(d => d.id === selectedDiscountId);
        if (!selected) return;
        discountToApply = {
            ...selected,
            type: normalizeDiscountType(selected.type),
            value: Number(selected.value) || 0,
        };
    }
    onSetBillDiscount(discountToApply);
    setMode(null);
  };
  
  const handleClearDiscount = () => {
    onSetBillDiscount(null);
    setMode(null);
  }

  const handleChargeSelect = (id: string) => {
    if (id === 'other') {
        setShowCustomCharge(true);
    } else {
        setShowCustomCharge(false);
        const selected = charges.find(c => c.id === id);
        if (selected) {
            onAddAdjustment(selected);
        }
    }
  }

  const handleApplyCustomCharge = () => {
    onAddCustomAdjustment(customChargeNote, customChargeAmount);
    setCustomChargeNote("");
    setCustomChargeAmount(0);
    setShowCustomCharge(false);
    setMode(null);
  };

  const handleModeChange = (newMode: EditorMode) => {
    setMode(prevMode => (prevMode === newMode ? null : newMode));
    if (newMode !== 'charge') {
        setShowCustomCharge(false);
    }
  };

  return (
    <div className="p-3 border-t bg-background space-y-2">
        <div className="grid grid-cols-2 gap-2">
            <Button variant={mode === 'discount' ? 'destructive' : 'outline'} size="sm" onClick={() => handleModeChange('discount')}>Bill Discount</Button>
            <Button variant={mode === 'charge' ? 'destructive' : 'outline'} size="sm" onClick={() => handleModeChange('charge')}>Add Charge</Button>
        </div>
        
        {/* --- ADJUSTMENTS DISPLAY --- */}
        {adjustments.length > 0 && (
             <div className="text-sm pt-2 space-y-1">
                {adjustments.map(adj => (
                    <div key={adj.id} className="flex justify-between items-center">
                        <span className="text-muted-foreground">{adj.note}</span>
                         <div className="flex items-center gap-2">
                            <span>+ ₱{adj.amount.toFixed(2)}</span>
                            {!isLocked && <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onRemoveAdjustment(adj.id)}><Trash2 size={12} /></Button>}
                        </div>
                    </div>
                ))}
            </div>
        )}

        {mode === 'discount' && (
            <EditorPanel title="Bill Discount" onClose={() => setMode(null)}>
                <Select onValueChange={handleDiscountSelect} disabled={isLocked} value={selectedDiscountId}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select discount..." /></SelectTrigger>
                    <SelectContent>
                        {discounts.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        <SelectItem value="custom">Others (Custom)</SelectItem>
                    </SelectContent>
                </Select>
                 <div className="flex items-center gap-1">
                    <Select 
                        value={tempDiscountType}
                        onValueChange={(type: 'percentage' | 'fixed') => setTempDiscountType(type)}
                        disabled={isLocked || !isCustomDiscount}
                    >
                        <SelectTrigger className="h-9 w-16"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="percentage">%</SelectItem>
                            <SelectItem value="fixed">₱</SelectItem>
                        </SelectContent>
                    </Select>
                    <CurrencyInput
                        value={tempDiscountValue}
                        onChange={setTempDiscountValue}
                        disabled={isLocked || !isCustomDiscount}
                    />
                </div>
                 <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={handleClearDiscount} disabled={isLocked}><Trash2 size={16} /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={handleApplyDiscount} disabled={isLocked}><Check size={16} /></Button>
                </div>
            </EditorPanel>
        )}
        
        {mode === 'charge' && (
             <EditorPanel title="Add Charge" onClose={() => setMode(null)}>
                <Select onValueChange={handleChargeSelect} disabled={isLocked}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select a charge to add..." /></SelectTrigger>
                    <SelectContent>
                        {charges.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.type === 'fixed' ? `₱${c.value}` : `${c.value}%`})</SelectItem>)}
                        <SelectItem value="other">Other (Custom)</SelectItem>
                    </SelectContent>
                </Select>
                {showCustomCharge && (
                    <div className="space-y-2 pt-2 border-t">
                        <Input 
                            placeholder="Charge Note (e.g., Spill Fee)"
                            value={customChargeNote}
                            onChange={(e) => setCustomChargeNote(e.target.value)}
                            className="h-9"
                        />
                        <CurrencyInput 
                            value={customChargeAmount}
                            onChange={setCustomChargeAmount}
                        />
                        <Button size="sm" className="w-full" onClick={handleApplyCustomCharge} disabled={!customChargeNote || customChargeAmount <= 0}>Apply Custom Charge</Button>
                    </div>
                )}
             </EditorPanel>
        )}
    </div>
  );
}
