
'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

interface StatCardProps {
    title: string;
    value: number | string;
    icon: React.ReactNode;
    format?: 'currency' | 'number' | 'custom';
    customFormatter?: (value: number) => string;
    linkTo?: string;
}

export function StatCard({ title, value, icon, format = 'number', customFormatter, linkTo }: StatCardProps) {
    const formattedValue = () => {
      if (format === 'currency' && typeof value === 'number') {
        return formatCurrency(value);
      }
      if (format === 'custom' && typeof value === 'number' && customFormatter) {
        return customFormatter(value);
      }
      if (typeof value === 'number') {
          return value.toLocaleString();
      }
      return value;
    }

    const CardInnerContent = () => (
      <>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {icon}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formattedValue()}</div>
        </CardContent>
      </>
    );

    if (linkTo) {
        return (
            <a href={linkTo} className="block hover:shadow-lg transition-shadow">
                <Card>
                    <CardInnerContent />
                </Card>
            </a>
        )
    }

    return (
        <Card>
           <CardInnerContent />
        </Card>
    );
}
