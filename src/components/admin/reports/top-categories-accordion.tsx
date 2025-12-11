
'use client';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ItemSalesData {
  itemName: string;
  quantity: number;
  receipts: string[];
}

export interface CategorySalesData {
  categoryName: string;
  totalQuantity: number;
  items: ItemSalesData[];
}

interface TopCategoriesAccordionProps {
  data: CategorySalesData[];
}

export function TopCategoriesAccordion({ data }: TopCategoriesAccordionProps) {
  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">No data to display.</p>;
  }

  return (
    <ScrollArea className="h-96">
      <Accordion type="multiple" className="w-full">
        {data.map((category) => (
          <AccordionItem key={category.categoryName} value={category.categoryName}>
            <AccordionTrigger>
              <div className="flex w-full items-center justify-between pr-4">
                <span className="font-semibold">{category.categoryName}</span>
                <Badge variant="secondary">{category.totalQuantity}</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <Accordion type="multiple" className="w-full pl-4">
                {category.items.map((item) => (
                  <AccordionItem key={item.itemName} value={item.itemName}>
                    <AccordionTrigger className="py-2 hover:no-underline">
                        <div className="flex w-full items-center justify-between pr-4">
                            <span className="text-xs font-medium">{item.itemName}</span>
                            <span className="text-xs font-bold">{item.quantity}</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-2">
                      <div className="px-4 py-2 bg-muted/50 rounded-md">
                        <p className="text-xs font-semibold mb-2">Receipts:</p>
                        <div className="flex flex-wrap gap-1">
                          {item.receipts.map((receipt, index) => (
                            <Badge key={`${receipt}-${index}`} variant="outline" className="text-[10px] font-mono">
                              {receipt}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </ScrollArea>
  );
}
