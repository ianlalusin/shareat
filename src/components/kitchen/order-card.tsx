'use client';

import React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Order, OrderItem, RefillItem } from '@/lib/types';
import { OrderTimer } from '@/components/cashier/order-timer';
import { CheckSquare } from 'lucide-react';

type KitchenItem = (OrderItem | RefillItem) & {
  orderId: string;
  sourceCollection: 'orderItems' | 'refills';
};

interface KitchenOrderCardProps {
  order?: Order;
  items: KitchenItem[];
  onServeItem?: (item: KitchenItem) => void;
  onServeAll?: (items: KitchenItem[]) => void;
}

function KitchenOrderCardBase({
  order,
  items,
  onServeItem,
  onServeAll,
}: KitchenOrderCardProps) {
  const tableLabel =
    order?.tableName || `Order ${order?.id?.slice(-4) || ''}`;

  const handleServeAllClick = () => {
    if (!onServeAll || items.length === 0) return;
    onServeAll(items);
  };

  return (
    <Card className="flex flex-col bg-background">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-lg font-bold">{tableLabel}</p>
            {order?.priority === 'rush' && (
              <Badge variant="destructive" className="text-[10px]">
                RUSH
              </Badge>
            )}
          </div>
          {order?.customerName && (
            <p className="text-xs text-muted-foreground">
              {order.customerName}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="text-right">
            <p className="text-xs font-semibold">Time</p>
            <OrderTimer startTime={order?.orderTimestamp} />
          </div>

          {onServeAll && items.length > 0 && (
            <Button
              size="xs"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={handleServeAllClick}
            >
              <CheckSquare className="h-3 w-3 mr-1" />
              Serve All
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2 pb-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-md bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm"
          >
            <span className="font-semibold">
              {item.quantity}x {item.menuName}
            </span>
            {onServeItem && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => onServeItem(item)}
              >
                Serve
              </Button>
            )}
          </div>
        ))}

        {order?.kitchenNote && (
          <div className="mt-2 rounded-md border border-dashed px-3 py-2 text-xs bg-muted/40">
            <Badge variant="outline" className="mr-2">
              Note
            </Badge>
            {order.kitchenNote}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const KitchenOrderCard = React.memo(KitchenOrderCardBase);
