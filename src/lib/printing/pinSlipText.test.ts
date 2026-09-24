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
