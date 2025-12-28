

"use client";

import { useMemo, useState } from "react";
import { KitchenTicket } from "@/app/kitchen/page";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";

interface HistoryViewProps {
    items: KitchenTicket[];
}

const ITEMS_PER_PAGE = 10;

export function HistoryView({ items }: HistoryViewProps) {
    const [currentPage, setCurrentPage] = useState(0);

    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const startIndex = currentPage * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentItems = items.slice(startIndex, endIndex);

    const goToNextPage = () => {
        setCurrentPage((prev) => Math.min(prev + 1, totalPages - 1));
    };

    const goToPreviousPage = () => {
        setCurrentPage((prev) => Math.max(prev - 1, 0));
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Order History</CardTitle>
                <CardDescription>Recently completed or cancelled items.</CardDescription>
            </CardHeader>
            <CardContent>
                {items.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No items in history yet.</p>
                ) : (
                    <div className="space-y-2">
                        {currentItems.map(item => {
                             const isAlaCarte = item.sessionMode === 'alacarte';
                             const displayLocation = isAlaCarte ? item.customerName || 'Ala Carte' : `Table ${item.tableNumber}`;
                             return (
                            <div key={item.id} className="border rounded-lg p-3 text-sm">
                                <div className="flex justify-between items-center">
                                    <p className="font-semibold">{displayLocation}</p>
                                    <Badge 
                                        variant="outline"
                                        className={cn(
                                            "capitalize",
                                            item.status === 'served' && "bg-green-100 text-green-800 border-green-300",
                                            item.status === 'cancelled' && "bg-red-100 text-red-800 border-red-300",
                                        )}
                                    >
                                        {item.status}
                                    </Badge>
                                </div>
                                <p className="text-muted-foreground">{item.itemName}</p>
                            </div>
                        )})}
                    </div>
                )}
            </CardContent>
             <CardFooter className="flex justify-between items-center">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToPreviousPage} disabled={currentPage === 0}>
                    <ArrowLeft className="h-4 w-4" />
                    <span className="sr-only">Previous Page</span>
                </Button>
                <span className="text-sm text-muted-foreground">
                    Page {currentPage + 1} of {totalPages > 0 ? totalPages : 1}
                </span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToNextPage} disabled={currentPage >= totalPages - 1}>
                    <ArrowRight className="h-4 w-4" />
                    <span className="sr-only">Next Page</span>
                </Button>
            </CardFooter>
        </Card>
    );
}
