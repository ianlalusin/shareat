
'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layers } from "lucide-react";

export interface TopCategory {
    name: string;
    quantity: number;
    items: Record<string, number>;
}

interface TopItemsByCategoryCardProps {
    title: string;
    categories: TopCategory[];
    onCategoryClick: (category: TopCategory) => void;
}

export function TopItemsByCategoryCard({ title, categories, onCategoryClick }: TopItemsByCategoryCardProps) {

    return (
        <Card className="col-span-2">
            <CardHeader>
                <CardTitle className="flex items-center justify-between text-sm font-medium">
                    {title}
                    <Layers className="h-4 w-4 text-muted-foreground" />
                </CardTitle>
            </CardHeader>
            <CardContent>
                {categories.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-4">No category data.</div>
                ) : (
                    <div className="space-y-2">
                        {categories.map((cat) => (
                            <button
                                key={cat.name}
                                onClick={() => onCategoryClick(cat)}
                                className="flex justify-between text-sm w-full text-left hover:bg-muted/50 p-1 rounded-md"
                            >
                                <span className="font-medium truncate pr-2">{cat.name}</span>
                                <span className="font-bold">{cat.quantity}</span>
                            </button>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
