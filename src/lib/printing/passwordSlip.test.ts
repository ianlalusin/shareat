import { describe, it, expect, vi } from "vitest";
import { buildPasswordSlipDocument, printPasswordSlipInPopup } from "./passwordSlip";

// Minimal DOM: elements only gain children through appendChild, text only
// through textContent, and serialization escapes text like a browser does.
// Any HTML-parsing path (innerHTML/outerHTML/write) throws.
class FakeNode {
  children: FakeNode[] = [];
  className = "";
  private text = "";
  constructor(public tagName: string) {}
  set textContent(v: string) { this.text = v; this.children = []; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(""); }
  appendChild(c: FakeNode) { this.children.push(c); return c; }
  set innerHTML(_v: string) { throw new Error("innerHTML used"); }
  set outerHTML(_v: string) { throw new Error("outerHTML used"); }
  serialize(): string {
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cls = this.className ? ` class="${this.className}"` : "";
    return `<${this.tagName}${cls}>${esc(this.text)}${this.children.map(c => c.serialize()).join("")}</${this.tagName}>`;
  }
}

function fakeDocument() {
  const created: string[] = [];
  const doc: any = {
    title: "",
    head: new FakeNode("head"),
    body: new FakeNode("body"),
    createElement: (tag: string) => { created.push(tag.toLowerCase()); return new FakeNode(tag.toLowerCase()); },
    write: () => { throw new Error("document.write used"); },
    open: () => { throw new Error("document.open used"); },
  };
  return { doc, created };
}

const PAYLOAD = "<img src=x onerror=alert(1)>";

describe("password slip (F01)", () => {
  it("prints a markup-like name, phone and password literally, never as elements", () => {
    const { doc, created } = fakeDocument();
    buildPasswordSlipDocument(doc, {
      name: PAYLOAD,
      phone: `"><script>alert(2)</script>`,
      tempPassword: "a<b>'c\"",
      resetDate: "Oct 30, 2026 1:00 PM",
    });
    expect(created).not.toContain("img");
    expect(created).not.toContain("script");
    expect(created.every(t => t === "style" || t === "div")).toBe(true);
    const html = doc.body.serialize();
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(doc.body.textContent).toContain(PAYLOAD);
    expect(doc.body.textContent).toContain("a<b>'c\"");
  });

  it("opens the popup without an opener link and prints without document.write or inline script", () => {
    const { doc, created } = fakeDocument();
    const win: any = { opener: { secret: true }, document: doc, print: vi.fn(), focus: vi.fn(), close: vi.fn(), addEventListener: vi.fn() };
    const open = vi.fn(() => win);
    const ok = printPasswordSlipInPopup(open, { name: PAYLOAD, phone: "+639000000000", tempPassword: "TMP", resetDate: "d" });
    expect(ok).toBe(true);
    expect(win.opener).toBeNull();
    expect(win.print).toHaveBeenCalledTimes(1);
    expect(created).not.toContain("script");
  });

  it("reports a blocked popup", () => {
    expect(printPasswordSlipInPopup(() => null, { name: "A", phone: "1", tempPassword: "T", resetDate: "d" })).toBe(false);
  });
});
