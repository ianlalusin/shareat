import { describe, expect, it } from 'vitest';
import { formatPinText } from './receiptFormatter';

// Mirrors writePinSlipLines in ThermalPrinterPlugin.java.
const isPinLine = (line: string) => /^[A-Z0-9]{6}$/.test(line.trim());
const isBoldLine = (line: string) => line.startsWith('**');

describe('formatPinText', () => {
  const slip = formatPinText({ pin: 'K7Q2ZX', customerName: 'Ana', storeName: 'SharEat Lipa', width: 58 });
  const top = slip.top.split('\n');
  const bottom = slip.bottom.split('\n');

  it('goes straight from the welcome to the join instructions', () => {
    expect(top.filter(Boolean)).toEqual([
      'Welcome Ana,',
      'Scan the QR code or go to',
      '**CUSTOMER.SHAREAT.NET',
      'and enter this PIN to access',
      'our smart refilling system.',
    ]);
  });

  it('marks only the site line bold, and it alone on its line', () => {
    expect(top.filter(isBoldLine)).toEqual(['**CUSTOMER.SHAREAT.NET']);
  });

  it('prints the PIN as the one PIN-styled line (bold, double size)', () => {
    expect([...top, ...bottom].filter(isPinLine)).toEqual(['K7Q2ZX']);
  });

  it('keeps every fixed line within 58mm (32 chars)', () => {
    for (const line of [...top.slice(1), ...bottom]) {
      expect(line.replace(/^\*\*/, '').length).toBeLessThanOrEqual(32);
    }
  });
});

describe('formatPinText with a table label', () => {
  const build = (tableLabel?: string | null) =>
    formatPinText({ pin: 'K7Q2ZX', customerName: 'Ana', storeName: 'SharEat Lipa', width: 58, tableLabel });
  const topLines = (tableLabel?: string | null) => build(tableLabel).top.split('\n');
  const allLines = (tableLabel?: string | null) => {
    const s = build(tableLabel);
    return [...s.top.split('\n'), ...s.bottom.split('\n')];
  };

  it('puts the table on its own bold line right after the welcome', () => {
    expect(topLines('Table 1').filter(Boolean)).toEqual([
      'Welcome Ana,',
      '**Table 1',
      'Scan the QR code or go to',
      '**CUSTOMER.SHAREAT.NET',
      'and enter this PIN to access',
      'our smart refilling system.',
    ]);
  });

  it('prefixes a 6-char uppercase label so it is never PIN-styled', () => {
    const all = allLines('VIP001');
    expect(all).toContain('**Table VIP001');
    expect(all.filter(isPinLine)).toEqual(['K7Q2ZX']);
  });

  it('truncates a long label to 32 chars', () => {
    expect(topLines('x'.repeat(50))[1]).toBe('**' + 'x'.repeat(32));
  });

  it('keeps the prefixed label within 32 chars', () => {
    const line = topLines('A'.repeat(6) + 'b'.repeat(40))[1];
    expect(line.startsWith('**')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(34);
    expect(allLines('ABC123').filter(isPinLine)).toEqual(['K7Q2ZX']);
  });

  it('adds no line when the label is empty or missing', () => {
    const base = build().top;
    expect(build(null).top).toBe(base);
    expect(build('   ').top).toBe(base);
    expect(base.split('\n').filter(Boolean)[1]).toBe('Scan the QR code or go to');
  });
});
