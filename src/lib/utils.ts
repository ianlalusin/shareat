import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { parse, isValid, format, isDate } from 'date-fns';
import { Timestamp } from "firebase/firestore";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatAndValidateDate(dateValue: string | Date | Timestamp): { formatted: string; error?: string } {
    if (!dateValue) {
        return { formatted: '' };
    }

    let dateString: string;
    if (dateValue instanceof Timestamp) {
        dateString = dateValue.toDate().toLocaleDateString('en-US');
    } else if (isDate(dateValue)) {
        dateString = (dateValue as Date).toLocaleDateString('en-US');
    } else {
        dateString = dateValue;
    }

    const parsedDate = parse(dateString, 'M/d/yyyy', new Date());

    if (isValid(parsedDate)) {
        return { formatted: format(parsedDate, 'MMMM dd, yyyy') };
    }

    // Try parsing the long format too, in case user comes back to the field
    const parsedLongDate = parse(dateString, 'MMMM dd, yyyy', new Date());
    if (isValid(parsedLongDate)) {
        return { formatted: dateString }; // It's already in the long format
    }

    return {
        formatted: dateString,
        error: "Invalid format. Use MM/DD/YYYY",
    };
}

export function revertToInputFormat(dateString: string): string {
    if (!dateString) return '';
    try {
        const parsedDate = parse(dateString, 'MMMM dd, yyyy', new Date());
        if (isValid(parsedDate)) {
            return format(parsedDate, 'M/d/yyyy');
        }
    } catch (error) {
        // Not in long format, return original
    }
    return dateString;
}

export function autoformatDate(currentValue: string, previousValue: string): string {
  let updatedValue = currentValue;
  // Automatically add "/" after month and day
  if (currentValue.length > (previousValue?.length || 0)) {
    if (currentValue.length === 2 && !currentValue.includes('/')) {
      updatedValue = `${currentValue}/`;
    } else if (currentValue.length === 5 && currentValue.split('/').length === 2) {
      updatedValue = `${currentValue}/`;
    }
  }
  return updatedValue;
}

export function formatCurrency(value: number | string | undefined | null) {
  if (value === null || value === undefined || value === '') {
    return '₱0.00';
  }

  const numericValue =
    typeof value === 'number' ? value : parseCurrency(value);

  if (isNaN(numericValue)) return '₱0.00';

  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(numericValue);
}

export function parseCurrency(value: string | undefined | null): number {
  if (!value) return 0;
  const numberValue = value.replace(/[^0-9.-]+/g, '');
  return parseFloat(numberValue) || 0;
}

export const UNIT_OPTIONS = [
  { value: "kg", label: "Kilogram (kg)" },
  { value: "g", label: "Gram (g)" },
  { value: "L", label: "Liter (L)" },
  { value: "ml", label: "Milliliter (ml)" },
  { value: "pc", label: "Piece (pc)" },
  { value: "pack", label: "Pack" },
  { value: "bottle", label: "Bottle" },
  { value: "can", label: "Can" },
];
