
export function computeTaxFromGross(gross: number, rate?: number | null) {
  const r = rate ?? 0;
  if (r <= 0) {
    return {
      net: gross,
      tax: 0,
    };
  }
  const net = gross / (1 + r);
  const tax = gross - net;
  return { net, tax };
}
