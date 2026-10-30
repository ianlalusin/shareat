"use client";

import Image from "next/image";
import { AlertTriangle, Archive, Pencil, Power, PowerOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { QuickPriceCell } from "@/components/manager/inventory/quick-price-cell";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "@/lib/types";

type PriceField = "cost" | "sellingPrice" | "onlinePrice";
type ToggleField = "isActive" | "onlineEnabled" | "customerEnabled";

export interface InventoryItemCardProps {
  item: InventoryItem;
  /** Primary title (variant label when indented under a family). */
  label: string;
  /** Full display name, used for accessible labels. */
  ariaLabel: string;
  imageUrl: string | null;
  indent?: boolean;
  showArchived: boolean;
  warnings: { message: string }[];
  /** Online price is 0, so the item is withheld from the online store. */
  withheldOnline: boolean;
  canArchive: boolean;
  canRestore: boolean;
  onQuickPrice: (field: PriceField, next: number | null) => Promise<void>;
  onToggle: (field: ToggleField) => void;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Phone (<768px) presentation of one inventory row (audit F21).
 *
 * Same fields and handlers as the table row — every price editor, the
 * Online/Customer switches and all actions — laid out as a compact card so
 * nothing needs horizontal panning. Secondary read-only data sits under
 * Details. Money is never truncated.
 */
export function InventoryItemCard({
  item,
  label,
  ariaLabel,
  imageUrl,
  indent = false,
  showArchived,
  warnings,
  withheldOnline,
  canArchive,
  canRestore,
  onQuickPrice,
  onToggle,
  onEdit,
  onArchive,
  onRestore,
}: InventoryItemCardProps) {
  const online = item.onlineEnabled === true;
  const customer = item.customerEnabled === true;
  const subtitle = [item.subCategory || item.category, item.uom].filter(Boolean).join(" · ");

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        indent && "ml-4 border-dashed",
        !item.isActive && !showArchived && "opacity-60",
        warnings.length > 0 && "border-red-300 bg-red-50",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-muted-foreground">
          {imageUrl ? (
            <Image src={imageUrl} alt={ariaLabel} fill sizes="44px" style={{ objectFit: "cover" }} />
          ) : (
            <span aria-hidden>{initials(ariaLabel)}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium leading-snug" title={ariaLabel}>{label}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {subtitle && <span>{subtitle}</span>}
            {!showArchived && !item.isActive && <Badge variant="outline" className="text-[10px]">Inactive</Badge>}
            {showArchived && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          {showArchived ? (
            <Button variant="ghost" size="icon" className="h-10 w-10" title="Restore" disabled={!canRestore} onClick={onRestore}>
              <RefreshCw className="h-4 w-4" />
              <span className="sr-only">Restore {ariaLabel}</span>
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                title={item.isActive ? "Active — tap to deactivate" : "Inactive — tap to activate"}
                onClick={() => onToggle("isActive")}
              >
                {item.isActive ? <Power className="h-4 w-4 text-emerald-600" /> : <PowerOff className="h-4 w-4 text-muted-foreground" />}
                <span className="sr-only">{item.isActive ? "Deactivate" : "Activate"} {ariaLabel}</span>
              </Button>
              <Button variant="ghost" size="icon" className="h-10 w-10" title="Edit" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                <span className="sr-only">Edit {ariaLabel}</span>
              </Button>
              {canArchive && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-destructive hover:text-destructive"
                  title="Archive"
                  onClick={onArchive}
                >
                  <Archive className="h-4 w-4" />
                  <span className="sr-only">Archive {ariaLabel}</span>
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <p className="mt-2 flex items-start gap-1 text-xs font-medium text-red-700">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {warnings.map((w) => w.message).join(" ")}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">Cost</span>
          <QuickPriceCell
            value={item.cost}
            disabled={showArchived}
            ariaLabel={`Cost for ${ariaLabel}`}
            onCommit={(next) => onQuickPrice("cost", next)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">Store price</span>
          <QuickPriceCell
            value={item.sellingPrice}
            disabled={showArchived}
            ariaLabel={`Store price for ${ariaLabel}`}
            onCommit={(next) => onQuickPrice("sellingPrice", next)}
          />
        </label>
        <div className="space-y-1 text-xs text-muted-foreground">
          <span className="block">Online price</span>
          {online ? (
            <>
              <QuickPriceCell
                value={item.onlinePrice}
                allowEmpty
                placeholder={String(item.sellingPrice ?? 0)}
                disabled={showArchived}
                ariaLabel={`Online price for ${ariaLabel} — blank matches the store price`}
                onCommit={(next) => onQuickPrice("onlinePrice", next)}
              />
              {withheldOnline && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
                  <AlertTriangle className="h-3 w-3 shrink-0" /> Not shown online
                </span>
              )}
            </>
          ) : (
            <span className="block py-1.5 text-sm">Not sold online</span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex min-h-10 items-center gap-2">
          <Switch
            checked={online}
            onCheckedChange={() => onToggle("onlineEnabled")}
            disabled={showArchived}
            aria-label={`Offer ${ariaLabel} on the online store`}
          />
          Online
        </label>
        <label className="flex min-h-10 items-center gap-2">
          <Switch
            checked={customer}
            onCheckedChange={() => onToggle("customerEnabled")}
            disabled={showArchived}
            aria-label={`Offer ${ariaLabel} on the customer app`}
          />
          Customer app
        </label>
      </div>

      {(item.barcode || item.isAddon) && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none py-1">Details</summary>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {item.barcode && (
              <>
                <dt>Barcode</dt>
                <dd className="break-all font-mono">{item.barcode}</dd>
              </>
            )}
            {item.isAddon && (
              <>
                <dt>Type</dt>
                <dd>Add-on</dd>
              </>
            )}
          </dl>
        </details>
      )}
    </div>
  );
}
