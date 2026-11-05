"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { LetterKeyboard } from "./LetterKeyboard";
import { editField, wantsLettersKeyboard, type FieldLike } from "@/lib/letter-keyboard/edit";

type Field = HTMLInputElement | HTMLTextAreaElement;

const FLAG = "shareat:letterKb"; // "1" force on (e.g. browser testing), "0" force off

function isEnabled(): boolean {
  try {
    const v = window.localStorage.getItem(FLAG);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {}
  return Capacitor.isNativePlatform();
}

const isField = (n: unknown): n is Field => n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement;

// `data-lkb` marks fields we switched to inputmode="none", so our own marker is not
// mistaken for the field asking for a special keyboard. `data-lkb-off` = handed back.
function fieldLike(el: Field): FieldLike {
  return {
    tag: el.tagName.toLowerCase(),
    type: el instanceof HTMLInputElement ? el.type : null,
    inputMode: el.dataset.lkb ? "" : el.getAttribute("inputmode"),
    readOnly: el.readOnly,
    disabled: el.disabled,
    optOut: el.hasAttribute("data-no-letter-kb") || el.dataset.lkbOff === "1",
  };
}

// Set inputmode="none" BEFORE focus so Android never opens its own keyboard for the field.
function mark(el: Field) {
  if (wantsLettersKeyboard(fieldLike(el))) {
    el.setAttribute("inputmode", "none");
    el.dataset.lkb = "1";
  }
}

function setValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value); // bypasses React's value tracker
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * App-wide letters-only keyboard for the tablet app. Free-text boxes (names, notes,
 * search) type with it; number, phone, email, password and date boxes keep the tablet
 * keyboard. Opt a box out with data-no-letter-kb.
 */
export function LetterKeyboardHost() {
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState<Field | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => setEnabled(isEnabled()), []);

  useEffect(() => {
    if (!enabled) return;
    const markAll = (root: ParentNode) => root.querySelectorAll<Field>("input, textarea").forEach(mark);
    markAll(document);
    const mo = new MutationObserver((records) => {
      for (const r of records)
        r.addedNodes.forEach((n) => {
          if (isField(n)) mark(n);
          else if (n instanceof Element) markAll(n);
        });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    const onFocusIn = (e: FocusEvent) => {
      clearTimeout(hideTimer.current);
      const t = e.target;
      if (isField(t)) mark(t);
      setActive(isField(t) && t.dataset.lkb ? t : null);
    };
    const onFocusOut = () => {
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        const a = document.activeElement;
        if (!(isField(a) && a.dataset.lkb)) setActive(null);
      }, 200);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      mo.disconnect();
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      // Switched off: give every box back to the tablet keyboard.
      document.querySelectorAll<Field>("[data-lkb]").forEach((el) => {
        el.removeAttribute("inputmode");
        delete el.dataset.lkb;
      });
    };
  }, [enabled]);

  // While open: shrink dialogs/drawers above the keyboard (globals.css reads --lkb-h) and
  // keep the field in view, like the tablet keyboard's adjustResize does.
  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    if (!panel) return;
    const setH = () => document.documentElement.style.setProperty("--lkb-h", `${panel.offsetHeight}px`);
    setH();
    document.body.classList.add("lkb-open");
    const ro = new ResizeObserver(setH);
    ro.observe(panel);
    // Native, not React's onPointerDown: Next's React root is `document`, the same node Radix
    // listens on for "pointer down outside", and stopPropagation does not stop a sibling
    // listener on the same node. Stopping at the panel keeps a key tap from closing a pop-up.
    const stop = (e: Event) => e.stopPropagation();
    panel.addEventListener("pointerdown", stop);
    const t = setTimeout(() => active.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
    return () => {
      clearTimeout(t);
      panel.removeEventListener("pointerdown", stop);
      ro.disconnect();
      document.body.classList.remove("lkb-open");
      document.documentElement.style.removeProperty("--lkb-h");
    };
  }, [active]);

  const onKey = useCallback(
    (key: string) => {
      if (!active) return;
      const len = active.value.length;
      const r = editField(
        { value: active.value, start: active.selectionStart ?? len, end: active.selectionEnd ?? len, maxLength: active.maxLength },
        key
      );
      if (!r) return;
      setValue(active, r.value);
      try {
        active.setSelectionRange(r.caret, r.caret);
      } catch {}
    },
    [active]
  );

  const onTabletKeyboard = useCallback(() => {
    if (!active) return;
    const el = active;
    el.dataset.lkbOff = "1";
    delete el.dataset.lkb;
    el.removeAttribute("inputmode");
    setActive(null);
    el.blur();
    setTimeout(() => el.focus(), 50); // refocus so the tablet keyboard opens
  }, [active]);

  // shortcut: off only until the app is reopened (not saved), so staff are never stuck without it.
  const onSwitchOff = useCallback(() => {
    const el = active;
    setActive(null);
    setEnabled(false);
    if (!el) return;
    el.blur();
    setTimeout(() => el.focus(), 100); // after the effect cleanup freed the box, so the tablet keyboard opens
  }, [active]);

  if (!enabled || !active) return null;
  return (
    <div
      ref={panelRef}
      // The keyboard sits outside any open dialog: pointer-events-auto because modal dialogs
      // disable the rest of the page; the effect above stops pointerdown so a key tap is not an outside click.
      className="pointer-events-auto fixed inset-x-0 bottom-0 z-[100] border-t bg-background p-1.5 shadow-lg"
      onMouseDown={(e) => e.preventDefault()} // keep focus (and the caret) in the field
    >
      <LetterKeyboard
        onKey={onKey}
        onDone={() => active.blur()}
        onTabletKeyboard={onTabletKeyboard}
        onSwitchOff={onSwitchOff}
        showEnter={active instanceof HTMLTextAreaElement}
      />
    </div>
  );
}
