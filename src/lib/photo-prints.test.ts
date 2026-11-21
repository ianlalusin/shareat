import { describe, expect, it } from 'vitest';
import { summarizePrints, type PhotoPrintRow } from './photo-prints';

const row = (id: string, sessionId: string, status: PhotoPrintRow['status'], at: number, extra: Partial<PhotoPrintRow> = {}): PhotoPrintRow => ({
  id,
  sessionId,
  status,
  tableDisplayName: 'Table',
  customerName: '',
  imageUrl: '',
  createdAtMs: at,
  printedAtMs: status === 'printed' ? at + 1 : null,
  printCount: status === 'printed' ? 1 : 0,
  reprintCount: 0,
  ...extra,
});

describe('photo print counter', () => {
  it('counts one free print per table and the rest as extra', () => {
    const s = summarizePrints([row('a', 't1', 'printed', 1), row('b', 't1', 'printed', 2), row('c', 't2', 'printed', 3)]);
    expect(s).toMatchObject({ copies: 3, free: 2, extra: 1 });
    expect(s.kindById).toMatchObject({ a: 'free', b: 'extra', c: 'free' });
  });

  it('reprints of a bad print are counted apart and never charged', () => {
    const s = summarizePrints([row('a', 't1', 'printed', 1, { reprintCount: 2 })]);
    expect(s).toMatchObject({ copies: 1, free: 1, extra: 0, reprints: 2 });
  });

  it('a waiting request is free only when its table has none yet; declined ones do not count', () => {
    const s = summarizePrints([
      row('x', 't1', 'declined', 1),
      row('q1', 't1', 'queued', 2),
      row('q2', 't1', 'queued', 3),
      row('p', 't2', 'printed', 4),
      row('q3', 't2', 'queued', 5),
    ]);
    expect(s.waiting).toBe(3);
    expect(s.kindById).toMatchObject({ q1: 'free', q2: 'extra', q3: 'extra' });
    expect(s.kindById.x).toBeUndefined();
  });
});
