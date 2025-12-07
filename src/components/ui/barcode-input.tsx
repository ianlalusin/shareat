'use client';

import * as React from 'react';
import { ScanLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface BarcodeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    onScan?: () => void;
}

const BarcodeInput = React.forwardRef<HTMLInputElement, BarcodeInputProps>(
    ({ className, onScan, ...props }, ref) => {
        return (
            <div className={cn('flex w-full items-stretch', className)}>
                <Input
                    ref={ref}
                    type="text"
                    className="rounded-r-none focus-visible:ring-offset-0"
                    {...props}
                />
                <Button
                    type="button"
                    variant="outline"
                    className="rounded-l-none border-l-0 px-3"
                    onClick={onScan}
                    disabled={!onScan}
                    aria-label="Scan barcode"
                >
                    <ScanLine className="h-4 w-4" />
                </Button>
            </div>
        );
    }
);

BarcodeInput.displayName = 'BarcodeInput';

export { BarcodeInput };
