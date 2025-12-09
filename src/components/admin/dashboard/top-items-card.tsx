
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, ListOrdered } from "lucide-react";
import Link from 'next/link';

export interface TopItem {
    name: string;
    quantity: number;
}

interface TopItemsCardProps {
    title: string;
    items: TopItem[];
    linkTo?: string;
}

export function TopItemsCard({ title, items, linkTo }: TopItemsCardProps) {
    const CardContentWrapper = ({ children }: { children: React.ReactNode }) => (
        <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm font-medium">
                {title}
                <ListOrdered className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
        </CardHeader>
        <CardContent>
            {items.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">No data for this period.</div>
            ) : (
                <div className="space-y-2">
                    {items.map((item, index) => (
                        <div key={index} className="flex justify-between text-sm">
                            <span className="font-medium truncate pr-2">{item.name}</span>
                            <span className="font-bold">{item.quantity}</span>
                        </div>
                    ))}
                </div>
            )}
        </CardContent>
        {children}
    </Card>
    );

    if (linkTo) {
        return (
            <Link href={linkTo} className="block hover:shadow-lg transition-shadow">
                <Card>
                    <CardContentWrapper />
                </Card>
            </Link>
        )
    }

    return (
        <Card>
           <CardContentWrapper />
        </Card>
    );
}
