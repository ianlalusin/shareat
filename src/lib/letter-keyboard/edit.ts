// Pure helpers for the app-wide letters-only keyboard (kept free of the DOM so they can
// be unit-tested). The host component feeds them the focused field's state.

export type FieldLike = {
  tag: string; // lowercase tag name
  type?: string | null;
  inputMode?: string | null;
  readOnly?: boolean;
  disabled?: boolean;
  optOut?: boolean; // data-no-letter-kb present, or handed back to the tablet keyboard
};

// Types that take free text. Everything else (number, tel, email, password, date, ...)
// keeps the tablet keyboard, as does any field that already asks for a numeric pad.
const TEXT_TYPES = new Set(["", "text", "search"]);

export function wantsLettersKeyboard(f: FieldLike): boolean {
  if (f.optOut || f.readOnly || f.disabled) return false;
  if (f.inputMode && f.inputMode !== "text") return false;
  if (f.tag === "textarea") return true;
  return f.tag === "input" && TEXT_TYPES.has((f.type ?? "").toLowerCase());
}

export type Edit = { value: string; caret: number };

/** Applies one key press at the caret/selection. Returns null when nothing changes. */
export function editField(
  state: { value: string; start: number; end: number; maxLength?: number },
  key: string
): Edit | null {
  const { value } = state;
  const start = Math.min(state.start, state.end);
  const end = Math.max(state.start, state.end);
  if (key === "clear") return value ? { value: "", caret: 0 } : null;
  if (key === "back") {
    if (start !== end) return { value: value.slice(0, start) + value.slice(end), caret: start };
    if (start === 0) return null;
    return { value: value.slice(0, start - 1) + value.slice(end), caret: start - 1 };
  }
  const next = value.slice(0, start) + key + value.slice(end);
  if (state.maxLength != null && state.maxLength >= 0 && next.length > state.maxLength) return null;
  return { value: next, caret: start + key.length };
}
