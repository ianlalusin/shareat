

'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OrderTimer } from './order-timer';
import { Table as TableType, Order } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Flame } from 'lucide-react';
import { useSettings } from '@/context/settings-context';
import { cva } from 'class-variance-authority';

interface TableCardProps {
  table: TableType;
  order: Order | undefined;
  onViewOrderClick: (order: Order) => void;
  onTogglePriority: (order: Order) => void;
  onBillClick: (order: Order) => void;
}

const tableCardVariants = cva("bg-muted/30", {
  variants: {
    size: {
      normal: "",
      compact: "",
    },
    density: {
      comfortable: "",
      compact: "",
    }
  },
  compoundVariants: [
    {
      size: "normal",
      density: "comfortable",
      className: "p-4",
    },
    {
      size: "normal",
      density: "compact",
      className: "p-3",
    },
    {
      size: "compact",
      density: "comfortable",
      className: "p-2",
    },
    {
      size: "compact",
      density: "compact",
      className: "p-2",
    }
  ],
  defaultVariants: {
    size: "normal",
    density: "comfortable"
  }
});

const getStatusColor = (status: TableType['status']) => {
  switch (status) {
    case 'Available': return 'bg-green-500';
    case 'Occupied': return 'bg-red-500';
    case 'Reserved': return 'bg-yellow-500';
    case 'Inactive': return 'bg-gray-500';
    default: return 'bg-gray-300';
  }
};

const TableCardComponent: React.FC<TableCardProps> = ({ table, order, onViewOrderClick, onTogglePriority, onBillClick }) => {
  const { settings } = useSettings();
  const cardSize = settings.ui.cardSize;
  const cardDensity = settings.ui.cardDensity;

  if (!order) {
    return null;
  }
  
  const isPending = order.status === 'Pending Confirmation';

  return (
    <Card className={cn(
      tableCardVariants({ size: cardSize, density: cardDensity }),
      isPending && "border-yellow-500 bg-yellow-100 dark:bg-yellow-900/40"
    )}>
      <CardHeader className="p-0 flex-row items-start justify-between space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className={cn("font-bold", cardSize === 'compact' ? 'text-lg' : 'text-xl')}>
              {table.tableName}
            </CardTitle>
            {order?.priority === 'rush' && (
              <Badge variant="destructive" className="text-[10px]">
                Priority
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            {order.packageName}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Badge className={cn("text-white", getStatusColor(table.status))}>
            {isPending ? 'Pending' : table.status}
          </Badge>
          {order && !isPending && (
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
              {order.priority === 'rush' ? 'Priority' : 'Add to Priority'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0 pt-2">
        <div className={cn("space-y-0.5", cardSize === 'compact' ? 'text-xs' : 'text-sm')}>
          <p><span className="font-semibold">Customer:</span> {order.customerName || 'N/A'}</p>
          <p><span className="font-semibold">Guests:</span> {isPending ? 'N/A' : (order.guestCount || 'N/A')}</p>
          <OrderTimer startTime={order.orderTimestamp} />
        </div>
      </CardContent>
      <CardFooter className="p-0 pt-2 grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => onBillClick(order)} size={cardSize === 'compact' ? 'sm' : 'default'}>Bill</Button>
        <Button onClick={() => onViewOrderClick(order)} size={cardSize === 'compact' ? 'sm' : 'default'} disabled={isPending}>View Order</Button>
      </CardFooter>
    </Card>
  );
};

export const TableCard = React.memo(TableCardComponent);
