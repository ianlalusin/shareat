import type { Product } from "@/lib/types";

/**
 * A minimal, product-like interface to allow variant helpers
 * to work on different but related types like Product and InventoryItem.
 */
type ProductLike = {
  id?: string;
  name?: string | null;
  kind?: "single" | "group" | "variant" | null;
  groupId?: string | null;
  groupName?: string | null;
  variantLabel?: string | null;
  variant?: string | null; // legacy
  uom?: string;
  barcode?: string | null; // allow null
};


/**
 * Gets the kind of the product, defaulting to "single" if not specified.
 * This ensures backward compatibility with older product documents.
 * @param product The product object.
 * @returns The kind of the product: "single", "group", or "variant".
 */
export function getKind(product: ProductLike): "single" | "group" | "variant" {
    return product.kind ?? "single";
}

/**
 * Gets the effective variant label for a product.
 * It prioritizes the new `variantLabel` field but falls back to the legacy `variant` field.
 * @param product The product object.
 * @returns The variant label string, or null if none exists.
 */
export function getEffectiveVariantLabel(product: ProductLike): string | null {
    return product.variantLabel ?? product.variant ?? null;
}

/**
 * Checks if a product is a sellable SKU (Stock Keeping Unit).
 * A product is sellable if its kind is not "group".
 * @param product The product object.
 * @returns True if the product is a sellable SKU.
 */
export function isSellableSku(product: ProductLike): boolean {
    const kind = getKind(product);
    return kind !== "group";
}

/**
 * Gets a consistent key for grouping product variants.
 * For true variants, it uses the `groupId`. For all other products (single, legacy),
 * it uses the product's own ID, making them their own "group".
 * @param product The product object.
 * @returns The group key string.
 */
export function getGroupKey(product: ProductLike): string {
    const kind = getKind(product);
    if (kind === "variant" && product.groupId) {
        return product.groupId;
    }
    return product.id || "";
}

/**
 * Gets the display name for a product group.
 * It prioritizes the `groupName` field and falls back to the product's own `name`.
 * @param product The product object.
 * @returns The group title string.
 */
export function getGroupTitle(product: ProductLike): string {
    return product.groupName ?? product.name ?? "";
}

/**
 * Gets the full display name for a product, including its variant label if applicable.
 * e.g., "Coke (500ml)"
 * This function correctly handles both new variants and legacy single-variant products.
 * @param product The product object.
 * @returns The formatted display name string.
 */
export function getDisplayName(product: ProductLike): string {
    const vLabel = getEffectiveVariantLabel(product);
    const kind = getKind(product);

    // Only append variant label to sellable SKUs, not to the group itself.
    if (vLabel && kind !== "group") {
        return `${product.name} (${vLabel})`;
    }

    return product.name || "";
}
