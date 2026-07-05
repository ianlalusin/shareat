// ===== Task 1: Money conversion + amount validation =====

/** PayMongo QR Ph minimum chargeable amount, in centavos. Verify before go-live. */
export const MIN_QRPH_AMOUNT_CENTAVOS = 2000;

/** Convert a peso float to integer centavos, rounding away float artifacts. */
export function pesosToCentavos(pesos: number): number {
  return Math.round(pesos * 100);
}

/** Throw if the centavo amount is not a positive integer at or above the minimum. */
export function assertPayableAmount(centavos: number): void {
  if (!Number.isInteger(centavos)) {
    throw new Error(`Amount must be whole centavos, got ${centavos}`);
  }
  if (centavos < MIN_QRPH_AMOUNT_CENTAVOS) {
    throw new Error(
      `Amount ${centavos} is below the QR Ph minimum of ${MIN_QRPH_AMOUNT_CENTAVOS} centavos`,
    );
  }
}
