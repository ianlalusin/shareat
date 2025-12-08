'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OrderTimer } from '@/components/cashier/order-timer';
import type { Order, OrderItem, RefillItem } from '@/lib/types';
import { CheckSquare } from 'lucide-react';
import { DocumentReference } from 'firebase/firestore';

export type KitchenItem = (OrderItem | RefillItem) & {
  id: string;
  orderId: string;
  order?: Order;
  sourceCollection: 'orderItems' | 'refills';
  ref: DocumentReference;
};

interface KitchenOrderCardProps {
  order?: Order;
  items: KitchenItem[];
  onServeItem: (item: KitchenItem) => void | Promise<void>;
  onServeAll: () => void | Promise<void>;
}

export function KitchenOrderCard({
  order,
  items,
  onServeItem,
  onServeAll,
}: KitchenOrderCardProps) {
  if (!items.length) return null;

  const tableLabel = order?.tableName || `Order ${order?.id?.slice(-4) || ''}`;

  return (
    <Card className="bg-background flex flex-col">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl font-bold">{tableLabel}</CardTitle>
            {order?.priority === 'rush' && (
              <Badge variant="destructive" className="text-[10px]">
                RUSH
              </Badge>
            )}
          </div>
          {order?.packageName && (
            <p className="text-xs text-muted-foreground font-medium">
              {order.packageName}
              {order.guestCount ? ` • ${order.guestCount} guests` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs font-semibold">Time:</span>
          <OrderTimer startTime={order?.orderTimestamp} />
          <Button
            size="sm"
            variant="outline"
            className="mt-1"
            onClick={onServeAll}
          >
            Serve all
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pb-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-md bg-yellow-100 dark:bg-amber-900/30 px-4 py-3"
          >
            <div className="flex flex-col">
              <span className="font-semibold text-sm">
                {item.quantity}x {item.menuName}
              </span>

              {'kitchenNote' in item && (item as any).kitchenNote && (
                <span className="text-xs text-muted-foreground">
                  {(item as any).kitchenNote}
                </span>
              )}

              {item.sourceCollection === 'refills' && (
                <Badge variant="outline" className="mt-1 text-[10px]">
                  Refill
                </Badge>
              )}
            </div>

            <Button
              size="sm"
              variant="destructive"
              onClick={() => onServeItem(item)}
            >
              Serve
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
