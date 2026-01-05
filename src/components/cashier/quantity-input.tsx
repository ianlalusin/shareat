
"use client";

import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface QuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  disabled?: boolean;
  allowDecimal?: boolean;
}

export function QuantityInput({ value, onChange, className, disabled, allowDecimal = false }: QuantityInputProps) {
  const [displayValue, setDisplayValue] = useState(value.toString());

  useEffect(() => {
    // Update display value when the external value prop changes
    // But only if the input is not currently focused, to avoid interrupting user input.
    if (document.activeElement !== document.getElementById(`quantity-input-${value}`)) {
         setDisplayValue(value.toString());
    }
  }, [value]);

  const handleFocus = () => {
    if (parseFloat(displayValue) === 0) {
      setDisplayValue("");
    }
  };

  const handleBlur = () => {
    let numericValue = allowDecimal ? parseFloat(displayValue) : parseInt(displayValue, 10);
    if (isNaN(numericValue) || displayValue.trim() === "") {
      numericValue = 0;
    }
    setDisplayValue(String(numericValue)); 
    onChange(numericValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const regex = allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/;
    if (regex.test(rawValue)) {
      setDisplayValue(rawValue);
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const numericValue = allowDecimal ? parseFloat(displayValue) : parseInt(displayValue, 10);
    if (!isNaN(numericValue)) {
      onChange(numericValue);
    }
  };

  return (
    <Input
      id={`quantity-input-${value}`}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyUp={handleKeyUp}
      className={cn("h-9", className)}
      disabled={disabled}
    />
  );
}
