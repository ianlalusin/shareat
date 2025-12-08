
'use client';

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Order, OrderItem, RefillItem } from '@/lib/types';
import { OrderTimer } from '../cashier/order-timer';
import { Badge } from '@/components/ui/badge';


type KitchenItem = (OrderItem | RefillItem) & { orderId: string };

interface Props {
  order?: Order;
  items: KitchenItem[];
  onServeItem?: (item: KitchenItem) => void;
}

function KitchenOrderCardBase({ order, items, onServeItem }: Props) {
  const tableLabel = order?.tableName || `Order ${order?.id?.slice(-4) || ''}`;

  const displayItems = useMemo(() => {
    const map = new Map<
      string,
      { name: string; quantity: number; items: KitchenItem[] }
    >();
    items.forEach((i) => {
      const key = i.menuName;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += i.quantity;
        existing.items.push(i);
      } else {
        map.set(key, { name: i.menuName, quantity: i.quantity, items: [i] });
      }
    });
    return Array.from(map.values());
  }, [items]);
  
  const handleServeGroup = (groupItems: KitchenItem[]) => {
      if(onServeItem){
        groupItems.forEach(item => onServeItem(item));
      }
  }


  return (
    <Card className="flex flex-col bg-background">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <p className="text-lg font-bold">{tableLabel}</p>
          {order?.customerName && (
            <p className="text-xs text-muted-foreground">
              {order.customerName}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold">Time:</p>
          <OrderTimer startTime={order?.orderTimestamp} />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        {order?.kitchenNote && (
          <div className="mt-2 rounded-md border border-dashed border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 text-xs">
            <Badge variant="outline" className="mr-2 border-yellow-400">
              Note
            </Badge>
            {order.kitchenNote}
          </div>
        )}
        {displayItems.map(({ name, quantity, items: groupItems }) => {
            const kitchenNote = groupItems[0]?.kitchenNote;
            const priority = groupItems[0]?.priority;

            return (
              <div
                key={name}
                className="rounded-md bg-amber-50 dark:bg-amber-900/30 px-4 py-3"
              >
                 <div className="flex items-center justify-between">
                    <p className="font-semibold">
                      {quantity}x {name}
                    </p>
                    <Button
                      size="sm"
                      className="bg-destructive hover:bg-destructive/90"
                      onClick={() => handleServeGroup(groupItems)}
                    >
                      Serve
                    </Button>
                </div>
                 {priority === 'rush' && <Badge variant="destructive" className="mt-1">RUSH</Badge>}
                {kitchenNote && <p className="text-xs italic text-red-600 dark:text-red-400 mt-1 pl-1">Note: {kitchenNote}</p>}
              </div>
            )
        })}
      </CardContent>
    </Card>
  );
}

export const KitchenOrderCard = React.memo(KitchenOrderCardBase);
