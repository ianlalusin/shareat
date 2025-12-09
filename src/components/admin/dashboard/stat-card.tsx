
'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import Link from 'next/link';

interface StatCardProps {
    title: string;
    value: number;
    icon: React.ReactNode;
    format?: 'currency' | 'number';
    linkTo?: string;
}

export function StatCard({ title, value, icon, format = 'number', linkTo }: StatCardProps) {
    const formattedValue = format === 'currency' ? formatCurrency(value) : value.toLocaleString();

    const CardInnerContent = () => (
      <>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {icon}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formattedValue}</div>
        </CardContent>
      </>
    );

    if (linkTo) {
        return (
            <Link href={linkTo} className="block hover:shadow-lg transition-shadow">
                <Card>
                    <CardInnerContent />
                </Card>
            </Link>
        )
    }

    return (
        <Card>
           <CardInnerContent />
        </Card>
    );
}
