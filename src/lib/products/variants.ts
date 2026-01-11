import type { Product } from "@/lib/types";

/**
 * Checks if a product is a sellable SKU (Stock Keeping Unit).
 * A product is sellable if its kind is 'single' or 'variant'.
 * If the 'kind' is missing, it defaults to 'single'.
 * @param {Product} product The product object.
 * @returns {boolean} True if the product is a sellable SKU.
 */
export function isSellableSku(product: Partial<Product>): boolean {
    const kind = product.kind || "single";
    return kind === "single" || kind === "variant";
}

/**
 * Gets the display name for a product, including its variant label if it exists.
 * e.g., "Coke (500ml)"
 * @param {Product} product The product object.
 * @returns {string} The formatted display name.
 */
export function getDisplayName(product: Partial<Product>): string {
    if (product.kind === "variant" && product.variantLabel) {
        const baseName = product.groupName || product.name || "";
        return `${baseName} (${product.variantLabel})`;
    }
    return product.name || "";
}

/**
 * Gets a consistent key for grouping product variants.
 * This is either the explicit groupId or the product's own id if it's a group or single item.
 * @param {Product} product The product object.
 * @returns {string} The group key.
 */
export function getGroupKey(product: Partial<Product>): string {
    return product.groupId || product.id || "";
}
