
"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Check, X } from "lucide-react";
import { ScrollArea } from "../ui/scroll-area";

const normalizeHeader = (header: string) => {
    return header.toLowerCase().replace(/[^a-z0-9]/gi, '');
};

type RowData = {
    original: any;
    validated: any;
    errors: string[];
};

interface ProductImportPreviewDialogProps {
    isOpen: boolean;
    onClose: () => void;
    data: any[];
    onConfirm: (validatedData: any[]) => void;
}

export function ProductImportPreviewDialog({ isOpen, onClose, data, onConfirm }: ProductImportPreviewDialogProps) {
    
    const processedData = useMemo(() => {
        return data.map(row => {
            const newRow: RowData = { original: row, validated: {}, errors: [] };
            
            const normalizedRow = Object.entries(row).reduce((acc, [key, value]) => {
                acc[normalizeHeader(key)] = value;
                return acc;
            }, {} as Record<string, any>);

            // Validate name
            if (!normalizedRow.name) {
                newRow.errors.push("Product 'name' is required.");
            } else {
                newRow.validated.name = normalizedRow.name;
            }
            
            // Validate isActive
            const isActiveVal = normalizedRow.isactive;
            if (isActiveVal === undefined || isActiveVal === null || String(isActiveVal).trim() === "") {
                newRow.validated.isActive = true; // Default to true if blank
            } else {
                const lowerIsActive = String(isActiveVal).toLowerCase();
                if (['true', '1', 'yes'].includes(lowerIsActive)) {
                    newRow.validated.isActive = true;
                } else if (['false', '0', 'no'].includes(lowerIsActive)) {
                    newRow.validated.isActive = false;
                } else {
                    newRow.errors.push("Invalid 'isActive' value. Use true/false, 1/0, or yes/no.");
                }
            }
            
            newRow.validated.variantLabel = normalizedRow.variantlabel || null;
            newRow.validated.uom = normalizedRow.uom || "pcs";
            newRow.validated.category = normalizedRow.category || "Add-on";
            newRow.validated.subCategory = normalizedRow.subcategory || "Uncategorized";
            newRow.validated.barcode = normalizedRow.barcode || null;

            return newRow;
        });
    }, [data]);
    
    const hasErrors = processedData.some(row => row.errors.length > 0);
    
    const handleConfirm = () => {
        const validData = processedData
            .filter(row => row.errors.length === 0)
            .map(row => row.validated);
        onConfirm(validData);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] p-0 max-h-[90vh]">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle>Import Preview</DialogTitle>
                    <DialogDescription>Review the products to be imported. Rows with errors will be skipped.</DialogDescription>
                </DialogHeader>

                <div className="px-6">
                    {hasErrors && (
                        <Alert variant="destructive">
                            <AlertTitle>Validation Errors Found</AlertTitle>
                            <AlertDescription>Please check the rows marked in red. Only valid rows can be imported.</AlertDescription>
                        </Alert>
                    )}
                </div>

                <ScrollArea className="overflow-y-auto px-6">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Status</TableHead>
                                <TableHead>Name</TableHead>
                                <TableHead>Variant</TableHead>
                                <TableHead>Sub-Category</TableHead>
                                <TableHead>UOM</TableHead>
                                <TableHead>Barcode</TableHead>
                                <TableHead>Active</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {processedData.map((row, index) => (
                                <TableRow key={index} className={row.errors.length > 0 ? "bg-destructive/10" : ""}>
                                    <TableCell>
                                        {row.errors.length > 0 ? <X className="text-destructive"/> : <Check className="text-green-500" />}
                                    </TableCell>
                                    <TableCell>
                                        <div>{row.validated.name || <span className="text-muted-foreground italic">Missing</span>}</div>
                                        {row.errors.map((err, i) => <div key={i} className="text-xs text-destructive">{err}</div>)}
                                    </TableCell>
                                    <TableCell>{row.validated.variantLabel || '—'}</TableCell>
                                    <TableCell>{row.validated.subCategory}</TableCell>
                                    <TableCell>{row.validated.uom}</TableCell>
                                    <TableCell>{row.validated.barcode || '—'}</TableCell>
                                    <TableCell>
                                        <Badge variant={row.validated.isActive ? "default" : "secondary"}>
                                            {row.validated.isActive ? "Yes" : "No"}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
                
                <DialogFooter className="p-6 pt-4 border-t">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={hasErrors}>Confirm Import</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


    