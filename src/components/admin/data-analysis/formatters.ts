export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "₱0";
  if (Math.abs(value) >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `₱${(value / 1_000).toFixed(1)}k`;
  return `₱${Math.round(value).toLocaleString()}`;
}

export function formatCurrencyFull(value: number): string {
  if (!Number.isFinite(value)) return "₱0.00";
  return `₱${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(value * 100).toFixed(digits)}%`;
}

export function deltaPercent(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 1;
  return (current - previous) / previous;
}
