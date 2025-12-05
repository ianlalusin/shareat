import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { parse, isValid, format } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatAndValidateDate(dateString: string): { formatted: string; error?: string } {
    if (!dateString) {
        return { formatted: '' };
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
