/**
 * A flavor is available in a store only when the store enabled it and its
 * global catalog entry is not explicitly inactive. Missing catalog rows stay
 * fail-open so legacy store flavors are not silently removed.
 */
export type StoreFlavorLike = { flavorId: string; isEnabled?: boolean };

export function globallyInactiveFlavorIds(
  globals: Array<{ id: string; isActive?: boolean }>
): Set<string> {
  return new Set(globals.filter((g) => g?.id && g.isActive === false).map((g) => g.id));
}

export function filterVisibleStoreFlavors<T extends StoreFlavorLike>(
  storeFlavors: T[],
  globalInactive: Set<string>
): T[] {
  return (storeFlavors || []).filter(
    (flavor) => flavor && flavor.flavorId && flavor.isEnabled !== false && !globalInactive.has(flavor.flavorId)
  );
}
