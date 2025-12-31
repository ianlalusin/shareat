
export function computeSessionLabel({
  sessionMode,
  customerName,
  tableNumber,
}: {
  sessionMode?: 'package_dinein' | 'alacarte' | null;
  customerName?: string | null;
  tableNumber?: string | number | null;
}): string {
  if (sessionMode === 'alacarte') {
    return (customerName || 'Ala Carte').trim();
  }
  return `Table ${tableNumber ?? ''}`.trim();
}
