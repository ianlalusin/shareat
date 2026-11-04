import { describe, it, expect } from "vitest";
import { editField, wantsLettersKeyboard } from "./edit";

const at = (value: string, start = value.length, end = start, maxLength?: number) => ({ value, start, end, maxLength });

describe("editField", () => {
  it("inserts at the caret, not just at the end", () => {
    expect(editField(at("pk", 1), "o")).toEqual({ value: "pok", caret: 2 });
  });
  it("replaces a selection", () => {
    expect(editField(at("pork", 1, 3), "x")).toEqual({ value: "pxk", caret: 2 });
  });
  it("backspace removes the char before the caret, or the selection", () => {
    expect(editField(at("pork", 3), "back")).toEqual({ value: "pok", caret: 2 });
    expect(editField(at("pork", 1, 3), "back")).toEqual({ value: "pk", caret: 1 });
    expect(editField(at("pork", 0), "back")).toBeNull();
  });
  it("clear empties, and does nothing on an empty field", () => {
    expect(editField(at("pork"), "clear")).toEqual({ value: "", caret: 0 });
    expect(editField(at(""), "clear")).toBeNull();
  });
  it("respects maxLength", () => {
    expect(editField(at("abc", 3, 3, 3), "d")).toBeNull();
    expect(editField(at("ab", 2, 2, 3), "c")).toEqual({ value: "abc", caret: 3 });
  });
  it("types a newline into a textarea", () => {
    expect(editField(at("a"), "\n")).toEqual({ value: "a\n", caret: 2 });
  });
});

describe("wantsLettersKeyboard", () => {
  it("takes plain text inputs, search boxes and textareas", () => {
    expect(wantsLettersKeyboard({ tag: "input", type: "text" })).toBe(true);
    expect(wantsLettersKeyboard({ tag: "input", type: "" })).toBe(true);
    expect(wantsLettersKeyboard({ tag: "input", type: "search" })).toBe(true);
    expect(wantsLettersKeyboard({ tag: "textarea" })).toBe(true);
  });
  it("leaves number entry to the tablet keyboard", () => {
    expect(wantsLettersKeyboard({ tag: "input", type: "number" })).toBe(false);
    expect(wantsLettersKeyboard({ tag: "input", type: "tel" })).toBe(false);
    expect(wantsLettersKeyboard({ tag: "input", type: "text", inputMode: "numeric" })).toBe(false);
    expect(wantsLettersKeyboard({ tag: "input", type: "text", inputMode: "decimal" })).toBe(false);
  });
  it("leaves passwords, emails, dates, and opted-out or locked fields alone", () => {
    for (const type of ["password", "email", "date", "time", "url", "checkbox"]) {
      expect(wantsLettersKeyboard({ tag: "input", type })).toBe(false);
    }
    expect(wantsLettersKeyboard({ tag: "input", type: "text", optOut: true })).toBe(false);
    expect(wantsLettersKeyboard({ tag: "input", type: "text", readOnly: true })).toBe(false);
    expect(wantsLettersKeyboard({ tag: "input", type: "text", disabled: true })).toBe(false);
  });
});
