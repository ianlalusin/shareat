import { slugify } from "@/lib/utils/slugify";
import type { ProductRequest, ProductRequestKind, ProductRequestStatus } from "@/lib/types";

/**
 * Pure helpers shared by the API route and the request UI.
 *
 * Deliberately free of firebase and React imports so the Node route handler and
 * the client components can both pull from here without dragging the other
 * runtime's SDK along.
 */

/**
 * The sole duplicate-protection key for a proposed product.
 *
 * `slugify` lowercases, trims, collapses whitespace to "-", and strips
 * punctuation, so "Coke Zero", "coke  zero", and "Coke-Zero!" all collapse to
 * "coke-zero". Computed server-side on submit; never trusted from a client.
 */
export function buildNameKey(name: string, variant?: string | null): string {
  return slugify(`${name ?? ""} ${variant ?? ""}`.trim());
}

export const STATUS_LABEL: Record<ProductRequestStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
};

export const KIND_LABEL: Record<ProductRequestKind, string> = {
  addon: "Add-on",
  product: "Regular product",
};

export function statusBadgeVariant(
  status: ProductRequestStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "pending") return "default";
  if (status === "rejected") return "destructive";
  if (status === "approved") return "secondary";
  return "outline";
}

/**
 * A pending request can be withdrawn by the manager who raised it, or by any
 * platform admin. Everyone else — including another manager at the same store —
 * gets no cancel button.
 */
export function canCancel(
  request: Pick<ProductRequest, "status" | "requestedByUid">,
  uid: string | null | undefined,
  isPlatformAdmin: boolean
): boolean {
  if (request.status !== "pending") return false;
  if (isPlatformAdmin) return true;
  return !!uid && request.requestedByUid === uid;
}

/**
 * Mirrors the precondition in /manager/inventory handleToggle: an inventory item
 * may only carry isAddon: true when it has a positive selling price AND a
 * kitchen station. Used by the form (to require a station up front) and by the
 * approve op (to degrade rather than fail if the station vanished meanwhile).
 */
export function canEnableAddon(
  suggestedPrice: number,
  kitchenLocationId: string | null | undefined
): boolean {
  return Number(suggestedPrice) > 0 && !!kitchenLocationId;
}
