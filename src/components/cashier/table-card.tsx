
'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OrderTimer } from './order-timer';
import { Table as TableType, Order } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { Flame } from 'lucide-react';

interface TableCardProps {
  table: TableType;
  order: Order | undefined;
  onViewOrderClick: (order: Order) => void;
  onTogglePriority: (order: Order) => void;
}

const getStatusColor = (status: TableType['status']) => {
  switch (status) {
    case 'Available': return 'bg-green-500';
    case 'Occupied': return 'bg-red-500';
    case 'Reserved': return 'bg-yellow-500';
    case 'Inactive': return 'bg-gray-500';
    default: return 'bg-gray-300';
  }
};

const TableCardComponent: React.FC<TableCardProps> = ({ table, order, onViewOrderClick, onTogglePriority }) => {
  const router = useRouter();

  if (!order) {
    return null;
  }

  return (
    <Card className="bg-muted/30">
      <CardHeader className="p-4 flex-row items-start justify-between space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl font-bold">
              {table.tableName}
            </CardTitle>
            {order?.priority === 'rush' && (
              <Badge variant="destructive" className="text-[10px]">
                RUSH
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            {order.packageName}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Badge className={cn("text-white", getStatusColor(table.status))}>
            {table.status}
          </Badge>
          {order && (
            <Button
              size="sm"
              variant={order.priority === 'rush' ? 'destructive' : 'outline'}
              className="h-7 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePriority(order);
              }}
            >
              <Flame className="h-3 w-3 mr-1" />
              {order.priority === 'rush' ? 'Rush' : 'Make Rush'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="text-sm">
          <p><span className="font-semibold">Customer:</span> {order.customerName || 'N/A'}</p>
          <p><span className="font-semibold">Guests:</span> {order.guestCount || 'N/A'}</p>
          <OrderTimer startTime={order.orderTimestamp} />
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => router.push(`/cashier/order/${order.id}`)}>Bill</Button>
        <Button onClick={() => onViewOrderClick(order)}>View Order</Button>
      </CardFooter>
    </Card>
  );
};

export const TableCard = React.memo(TableCardComponent);
