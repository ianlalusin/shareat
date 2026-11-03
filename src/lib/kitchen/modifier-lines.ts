import type { SelectedModifier } from "@/lib/types";

/**
 * Kitchen-facing modifier lines, one per option group: "Dips - Cheese".
 * Picks from the same group share a line ("Dips - Cheese, Garlic").
 * Tickets without structured modifiers (online orders, older tickets) fall
 * back to their flat modifiersText, which has no group names.
 */
export function kitchenModifierLines(ticket: {
  modifiers?: SelectedModifier[] | null;
  modifiersText?: string | null;
}): string[] {
  const groups = new Map<string, string[]>();
  for (const m of ticket.modifiers ?? []) {
    const value = String(m?.valueName ?? "").trim();
    if (!value) continue;
    const group = String(m?.groupName ?? "").trim();
    groups.set(group, [...(groups.get(group) ?? []), value]);
  }
  if (groups.size > 0) {
    return [...groups].map(([group, values]) =>
      group ? `${group} - ${values.join(", ")}` : values.join(", ")
    );
  }
  const text = String(ticket.modifiersText ?? "").trim();
  return text ? [text] : [];
}
