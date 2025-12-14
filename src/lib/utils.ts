
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

    let date: Date | null = null;
    if (dateValue instanceof Timestamp) {
        date = dateValue.toDate();
    } else if (isDate(dateValue)) {
        date = dateValue as Date;
    } else {
        const parsedDate = parse(dateValue, 'M/d/yyyy', new Date());
        if (isValid(parsedDate)) {
          date = parsedDate;
        } else {
          const parsedLongDate = parse(dateValue, 'MMMM dd, yyyy', new Date());
          if (isValid(parsedLongDate)) {
            date = parsedLongDate;
          }
        }
    }

    if (date && isValid(date)) {
        return { formatted: format(date, 'MMMM dd, yyyy') };
    }

    return {
        formatted: String(dateValue),
        error: "Invalid format. Use MM/DD/YYYY",
    };
}


export function revertToInputFormat(dateString: string): string {
    if (!dateString) return '';
    try {
        const parsedDate = parse(dateString, 'MMMM dd, yyyy', new Date());
        if (isValid(parsedDate)) {
            return format(parsedDate, 'MM/dd/yyyy');
        }
    } catch (error) {
        // Not in long format, return original
    }
    return dateString;
}

export function autoformatDate(currentValue: string, previousValue?: string): string {
  const digits = currentValue.replace(/\D/g, '');
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
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

export function getDefaultRouteForRole(role: string): string {
  switch (role?.toLowerCase()) {
    case 'admin':
      return '/admin';
    case 'manager':
      return '/admin';
    case 'cashier':
      return '/cashier';
    case 'server':
      return '/refill';
    case 'kitchen':
      return '/kitchen';
    default:
      return '/admin';
  }
}
