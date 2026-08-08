"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Loader } from "lucide-react";
import { cn } from "@/lib/utils";
import { parsePriceDraft, formatPriceDraft, priceDraftChanged } from "@/lib/inventory/quick-edit";

interface QuickPriceCellProps {
  value: number | null | undefined;
  /** Persists the new value. Should throw on failure so the typed text survives. */
  onCommit: (next: number | null) => Promise<void>;
  /** Online price only: blank is a valid instruction meaning "no override". */
  allowEmpty?: boolean;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
}

/**
 * An inline, commit-on-blur price box for the inventory table.
 *
 * Two behaviours matter more than they look:
 *
 * 1. The table rows come from an `onSnapshot` listener, so `value` can change
 *    at any moment — including as a result of this cell's own write. The draft
 *    is therefore only re-synced from props while the cell is idle; a snapshot
 *    landing mid-keystroke must never overwrite what the manager is typing.
 * 2. An unchanged value is never written. Tabbing across a row would otherwise
 *    fire a write and a storefront republish per cell.
 */
export function QuickPriceCell({
  value,
  onCommit,
  allowEmpty = false,
  placeholder,
  disabled,
  ariaLabel,
}: QuickPriceCellProps) {
  const [draft, setDraft] = React.useState(() => formatPriceDraft(value));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Unsaved keystrokes. A ref, not state: it must be readable by the sync
  // effect without itself triggering a re-render.
  const dirtyRef = React.useRef(false);

  React.useEffect(() => {
    if (dirtyRef.current || saving) return;
    setDraft(formatPriceDraft(value));
  }, [value, saving]);

  const revert = () => {
    dirtyRef.current = false;
    setError(null);
    setDraft(formatPriceDraft(value));
  };

  const commit = async () => {
    if (saving || disabled) return;
    if (!dirtyRef.current) return; // nothing typed — don't even parse

    const parsed = parsePriceDraft(draft, { allowEmpty });
    if (!parsed.ok) {
      // Keep the offending text on screen so it can be corrected in place.
      setError(parsed.error);
      return;
    }
    setError(null);

    if (!priceDraftChanged(value, parsed.value)) {
      dirtyRef.current = false;
      setDraft(formatPriceDraft(parsed.value));
      return;
    }

    setSaving(true);
    try {
      await onCommit(parsed.value);
      dirtyRef.current = false;
      setDraft(formatPriceDraft(parsed.value));
    } catch {
      // The page toasts the failure; hold the typed value so it is not lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative w-[92px]">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 text-xs text-muted-foreground">
        ₱
      </span>
      <Input
        type="number"
        step="0.01"
        inputMode="decimal"
        aria-label={ariaLabel}
        aria-invalid={!!error}
        title={error ?? undefined}
        placeholder={placeholder}
        disabled={disabled || saving}
        value={draft}
        className={cn(
          "h-8 pl-5 pr-6 text-sm tabular-nums",
          error && "border-destructive focus-visible:ring-destructive"
        )}
        onChange={(e) => {
          dirtyRef.current = true;
          setError(null);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            revert();
            e.currentTarget.blur();
          }
        }}
      />
      {saving && (
        <Loader className="absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
