
"use client";

import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface QuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  disabled?: boolean;
}

export function QuantityInput({ value, onChange, className, disabled }: QuantityInputProps) {
  const [displayValue, setDisplayValue] = useState(value.toString());

  useEffect(() => {
    // Update display value when the external value prop changes
    // But only if the input is not currently focused, to avoid interrupting user input.
    if (document.activeElement !== document.getElementById(`quantity-input-${value}`)) {
         setDisplayValue(value.toString());
    }
  }, [value]);

  const handleFocus = () => {
    if (displayValue === "0") {
      setDisplayValue("");
    }
  };

  const handleBlur = () => {
    let numericValue = parseInt(displayValue, 10);
    if (isNaN(numericValue) || displayValue.trim() === "") {
      numericValue = 0;
    }
    // Normalize value (e.g., remove leading zeros like '005' -> '5')
    setDisplayValue(String(numericValue)); 
    onChange(numericValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    // Allow only digits, and allow an empty string for clearing the input
    if (/^\d*$/.test(rawValue)) {
      setDisplayValue(rawValue);
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const numericValue = parseInt(displayValue, 10);
    if (!isNaN(numericValue)) {
      onChange(numericValue);
    }
  };

  return (
    <Input
      id={`quantity-input-${value}`} // A semi-stable ID for focus check
      type="text" // Use text to allow empty string during editing
      inputMode="numeric" // Hint for mobile keyboards
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
