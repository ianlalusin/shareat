"use client";

import { Button } from "@/components/ui/button";
import { Delete } from "lucide-react";

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/**
 * Letters-only keyboard face: no symbols, emoji or number row, so it stays short.
 * Pure UI. LetterKeyboardHost decides which field it types into.
 * "123" hands the current field back to the tablet keyboard for numbers and symbols.
 */
export function LetterKeyboard({
  onKey,
  onDone,
  onTabletKeyboard,
  showEnter,
}: {
  onKey: (key: string) => void;
  onDone: () => void;
  onTabletKeyboard: () => void;
  showEnter: boolean;
}) {
  return (
    <div className="space-y-1.5" data-testid="letter-keyboard">
      {ROWS.map((row, i) => (
        <div key={row} className="flex justify-center gap-1.5">
          {row.split("").map((k) => (
            <Button key={k} type="button" variant="outline" className="h-11 min-w-0 flex-1 px-0 text-base uppercase" onClick={() => onKey(k)}>
              {k}
            </Button>
          ))}
          {i === ROWS.length - 1 && (
            <Button type="button" variant="outline" className="h-11 min-w-0 flex-[1.5] px-0" aria-label="Backspace" onClick={() => onKey("back")}>
              <Delete className="h-5 w-5" />
            </Button>
          )}
        </div>
      ))}
      <div className="flex gap-1.5">
        <Button type="button" variant="outline" className="h-11 flex-1 px-0" onClick={onTabletKeyboard}>
          123
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1 px-0" onClick={() => onKey("clear")}>
          Clear
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-[4]" onClick={() => onKey(" ")}>
          space
        </Button>
        {showEnter && (
          <Button type="button" variant="outline" className="h-11 flex-1 px-0" aria-label="New line" onClick={() => onKey("\n")}>
            ↵
          </Button>
        )}
        <Button type="button" className="h-11 flex-1 px-0" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
