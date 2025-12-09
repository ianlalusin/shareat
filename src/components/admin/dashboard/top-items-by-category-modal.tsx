
'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TopCategory } from './top-categories-card';

interface TopItemsByCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: TopCategory | null;
}

export function TopItemsByCategoryModal({
  isOpen,
  onClose,
  category,
}: TopItemsByCategoryModalProps) {
  if (!category) return null;

  const sortedItems = Object.entries(category.items).sort(([, a], [, b]) => b - a);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Top Items in {category.name}</DialogTitle>
          <DialogDescription>
            Total quantity sold in this category: {category.quantity}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Quantity Sold</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map(([name, quantity]) => (
                <TableRow key={name}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="text-right font-bold">{quantity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
