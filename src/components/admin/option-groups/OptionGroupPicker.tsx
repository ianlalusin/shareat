"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Attach / detach / reorder option groups on one item.
 *
 * Shared by three callers, which is the whole point — the same picker appears
 * on the family parent, on an individual variant, and on a store's inventory
 * row, and those three must agree on ordering and on what "attached" means:
 *
 *   admin  → product-edit-dialog: the family parent (applies to every variant)
 *   admin  → product-edit-dialog: one variant (adds to what the family gives it)
 *   manager→ edit-inventory-dialog: this store only (no `onCreateNew` — authoring
 *            shared groups stays admin-only; a manager attaches existing ones)
 *
 * Order matters: it is the order the cashier and the diner are prompted in.
 *
 * `inheritedIds` are shown read-only, so someone editing a variant can see what
 * the family already contributes and does not re-attach it by hand.
 */

export type PickableOptionGroup = {
  id: string;
  name: string;
  selectionMode?: "single" | "multi";
  values?: Array<{ isActive?: boolean }>;
};

function groupMeta(g: PickableOptionGroup): string {
  const mode = g.selectionMode === "multi" ? "Multi-select" : "Single-select";
  const count = (g.values || []).filter((v) => v?.isActive !== false).length;
  return `${mode} · ${count} value${count === 1 ? "" : "s"}`;
}

export function OptionGroupPicker({
  value,
  onChange,
  available,
  label = "Option Groups (Modifiers)",
  description,
  onCreateNew,
  inheritedIds = [],
  inheritedLabel = "From the family",
}: {
  value: string[] | undefined;
  onChange: (ids: string[]) => void;
  available: PickableOptionGroup[];
  label?: string;
  description?: string;
  /** Omit to hide the "+ New group" button — managers attach, they don't author. */
  onCreateNew?: () => void;
  /** Groups this item already gets from elsewhere. Read-only. */
  inheritedIds?: string[];
  inheritedLabel?: string;
}) {
  const attached = Array.isArray(value) ? value : [];
  const attachedSet = new Set(attached);
  const inheritedSet = new Set(inheritedIds);
  // An inherited group is already in effect, so offering it again would create
  // a duplicate the resolver silently de-dupes — confusing rather than harmful.
  const unattached = available.filter((g) => !attachedSet.has(g.id) && !inheritedSet.has(g.id));
  const inherited = available.filter((g) => inheritedSet.has(g.id));

  const move = (i: number, dir: -1 | 1) => {
    const next = [...attached];
    const t = i + dir;
    if (t < 0 || t >= next.length) return;
    [next[i], next[t]] = [next[t], next[i]];
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {onCreateNew ? (
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={onCreateNew}>
            + New group
          </Button>
        ) : null}
      </div>

      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}

      <div className="grid gap-2 mt-2">
        {inherited.length > 0 && (
          <div className="rounded-md border border-dashed px-3 py-2">
            <div className="text-[11px] font-medium text-muted-foreground">{inheritedLabel}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {inherited.map((g) => (
                <Badge key={g.id} variant="secondary" className="text-[11px]">
                  {g.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {attached.length === 0 ? (
          <p className="text-xs text-muted-foreground">No option groups attached.</p>
        ) : (
          <div className="space-y-1.5">
            {attached.map((id, i) => {
              const g = available.find((x) => x.id === id);
              return (
                <div key={id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{g?.name ?? `(missing: ${id})`}</div>
                    {g && <div className="text-[11px] text-muted-foreground">{groupMeta(g)}</div>}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(i, 1)} disabled={i === attached.length - 1} aria-label="Move down">↓</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => onChange(attached.filter((x) => x !== id))}>Remove</Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {unattached.length > 0 && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">Attach:</div>
            <div className="flex flex-wrap gap-1">
              {unattached.map((g) => (
                <Badge
                  key={g.id}
                  variant="outline"
                  className="cursor-pointer hover:bg-muted/40 text-[11px]"
                  onClick={() => onChange([...attached, g.id])}
                >
                  + {g.name}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {available.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {onCreateNew ? (
              <>No option groups yet. Click <span className="font-medium">+ New group</span> to create one.</>
            ) : (
              <>No option groups exist yet. An admin creates them under Admin → Menu.</>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
