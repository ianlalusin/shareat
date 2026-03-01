

export function computeSessionLabel({
  sessionMode,
  customerName,
  tableNumber,
  tableDisplayName,
}: {
  sessionMode?: 'package_dinein' | 'alacarte' | null;
  customerName?: string | null;
  tableNumber?: string | number | null;
  tableDisplayName?: string | null;
}): string {
  if (sessionMode === 'alacarte') {
    return (customerName || 'Ala Carte').trim();
  }
  return (tableDisplayName || `Table ${tableNumber ?? ''}`).trim();
}
