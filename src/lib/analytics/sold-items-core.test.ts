import { describe, it, expect } from 'vitest';
import { aggregateSoldItems, isSyntheticAddonLine, type ReceiptLite } from '@/lib/analytics/sold-items-core';

/** Builds an addon line with the real field names; qty defaults mirror a plain sale. */
function addon(opts: {
  itemId: string; itemName?: string; category?: string | null; barcode?: string | null;
  unitPrice?: number; qtyOrdered?: number; freeQty?: number; voidedQty?: number;
}) {
  return {
    type: 'addon',
    itemId: opts.itemId,
    itemName: opts.itemName ?? opts.itemId,
    category: opts.category ?? 'Drinks',
    barcode: opts.barcode ?? null,
    unitPrice: opts.unitPrice ?? 50,
    qtyOrdered: opts.qtyOrdered ?? 1,
    freeQty: opts.freeQty ?? 0,
    voidedQty: opts.voidedQty ?? 0,
  };
}

const receipt = (lines: any[], extra: Partial<ReceiptLite> = {}): ReceiptLite => ({
  status: 'final', lines, ...extra,
});

const only = (r: ReturnType<typeof aggregateSoldItems>) => {
  expect(r.items).toHaveLength(1);
  return r.items[0];
};

describe('isSyntheticAddonLine', () => {
  it('flags the delivery-fee and extra-pax synthetic ids', () => {
    expect(isSyntheticAddonLine('__delivery')).toBe(true);
    expect(isSyntheticAddonLine('bundleextra_pkg123')).toBe(true);
  });
  it('does not flag a real inventory doc id', () => {
    expect(isSyntheticAddonLine('abc123XYZ')).toBe(false);
    expect(isSyntheticAddonLine('delivery')).toBe(false);
  });
});

describe('aggregateSoldItems', () => {
  it('aggregates a plain sale', () => {
    const r = aggregateSoldItems([receipt([addon({ itemId: 'coke', qtyOrdered: 3, unitPrice: 50 })])]);
    const item = only(r);
    expect(item).toMatchObject({
      posItemId: 'coke', itemName: 'coke', category: 'Drinks',
      billableQty: 3, physicalQty: 3, freeQty: 0, voidedQty: 0, grossAmount: 150,
    });
    expect(r.receiptCount).toBe(1);
    expect(r.refundReceiptCount).toBe(0);
  });

  it('sums the same item across receipts', () => {
    const r = aggregateSoldItems([
      receipt([addon({ itemId: 'coke', qtyOrdered: 3 })]),
      receipt([addon({ itemId: 'coke', qtyOrdered: 2 })]),
    ]);
    expect(only(r).physicalQty).toBe(5);
    expect(r.receiptCount).toBe(2);
  });

  it('skips a voided receipt entirely (status and legacy isVoided)', () => {
    const r = aggregateSoldItems([
      receipt([addon({ itemId: 'coke', qtyOrdered: 3 })], { status: 'voided' }),
      receipt([addon({ itemId: 'coke', qtyOrdered: 2 })], { isVoided: true }),
    ]);
    expect(r.items).toHaveLength(0);
    expect(r.voidedReceiptCount).toBe(2);
    expect(r.receiptCount).toBe(0);
  });

  it('nets a full refund back to zero and drops the row', () => {
    // A refund receipt clones the original line with POSITIVE qty — the sign
    // flip in the aggregator is the only thing that stops it double-counting.
    const r = aggregateSoldItems([
      receipt([addon({ itemId: 'coke', qtyOrdered: 3 })]),
      receipt([addon({ itemId: 'coke', qtyOrdered: 3 })], { isRefund: true }),
    ]);
    expect(r.items).toHaveLength(0);
    expect(r.refundReceiptCount).toBe(1);
  });

  it('nets a partial refund', () => {
    const r = aggregateSoldItems([
      receipt([addon({ itemId: 'coke', qtyOrdered: 5, unitPrice: 50 })]),
      receipt([addon({ itemId: 'coke', qtyOrdered: 1, unitPrice: 50 })], { isRefund: true }),
    ]);
    const item = only(r);
    expect(item.physicalQty).toBe(4);
    expect(item.billableQty).toBe(4);
    expect(item.grossAmount).toBe(200);
  });

  it('separates comped units: free is physical but not billable', () => {
    // The whole reason the ERP deducts physicalQty — a comped drink still left
    // the fridge even though nobody paid for it.
    const item = only(aggregateSoldItems([
      receipt([addon({ itemId: 'coke', qtyOrdered: 5, freeQty: 2, unitPrice: 50 })]),
    ]));
    expect(item.billableQty).toBe(3);
    expect(item.physicalQty).toBe(5);
    expect(item.freeQty).toBe(2);
    expect(item.grossAmount).toBe(150);
  });

  it('excludes line-voided units from both billable and physical', () => {
    const item = only(aggregateSoldItems([
      receipt([addon({ itemId: 'coke', qtyOrdered: 5, voidedQty: 2 })]),
    ]));
    expect(item.billableQty).toBe(3);
    expect(item.physicalQty).toBe(3);
    expect(item.voidedQty).toBe(2);
  });

  it('handles free and voided together', () => {
    const item = only(aggregateSoldItems([
      receipt([addon({ itemId: 'coke', qtyOrdered: 10, freeQty: 2, voidedQty: 3 })]),
    ]));
    expect(item.billableQty).toBe(5);   // 10 - 3 - 2
    expect(item.physicalQty).toBe(7);   // 10 - 3
  });

  it('skips synthetic delivery and extra-pax lines', () => {
    const r = aggregateSoldItems([receipt([
      addon({ itemId: '__delivery', qtyOrdered: 1 }),
      addon({ itemId: 'bundleextra_pkg1', qtyOrdered: 2 }),
      addon({ itemId: 'coke', qtyOrdered: 1 }),
    ])]);
    expect(only(r).posItemId).toBe('coke');
    expect(r.skippedSyntheticLines).toBe(2);
  });

  it('ignores package lines — only addons are in scope', () => {
    const r = aggregateSoldItems([receipt([
      { ...addon({ itemId: 'unli-set-a', qtyOrdered: 4 }), type: 'package' },
      addon({ itemId: 'coke', qtyOrdered: 1 }),
    ])]);
    expect(only(r).posItemId).toBe('coke');
  });

  it('ignores lines with no itemId', () => {
    const r = aggregateSoldItems([receipt([addon({ itemId: '', qtyOrdered: 3 })])]);
    expect(r.items).toHaveLength(0);
  });

  it('keeps the most recent non-empty descriptor across receipts', () => {
    const r = aggregateSoldItems([
      receipt([addon({ itemId: 'coke', itemName: 'Coke', category: 'Drinks', barcode: '111' })]),
      receipt([addon({ itemId: 'coke', itemName: 'Coke in Can', category: 'Beverages', barcode: '' })]),
    ]);
    const item = only(r);
    expect(item.itemName).toBe('Coke in Can');
    expect(item.category).toBe('Beverages');
    expect(item.barcode).toBe('111');   // blank never clobbers a known value
  });

  it('returns an empty result for a day with no receipts', () => {
    const r = aggregateSoldItems([]);
    expect(r).toEqual({
      items: [], receiptCount: 0, refundReceiptCount: 0,
      voidedReceiptCount: 0, skippedSyntheticLines: 0,
    });
  });

  it('can go net-negative when refunds exceed same-day sales', () => {
    // Refund of a PRIOR day's order landing today. The ERP clamps this to 0 and
    // voids the prior usage record; the POS just reports the truth.
    const item = only(aggregateSoldItems([
      receipt([addon({ itemId: 'coke', qtyOrdered: 1 })]),
      receipt([addon({ itemId: 'coke', qtyOrdered: 4 })], { isRefund: true }),
    ]));
    expect(item.physicalQty).toBe(-3);
  });
});
