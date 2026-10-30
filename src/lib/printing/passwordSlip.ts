// Browser print of the Sharelebrator temporary-password slip (F01).
// Every value (name, phone, password, date) is customer- or server-controlled
// text, so it is placed with textContent on DOM nodes — never as HTML. The
// popup is cut off from its opener and printed from here, so it carries no
// inline script.

export interface PasswordSlipFields {
  name: string;
  phone: string;
  tempPassword: string;
  resetDate: string;
}

const SLIP_CSS = `
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; max-width: 380px; margin: 0 auto; color: #1a1a1a; }
.brand { text-align: center; font-weight: 900; font-size: 20px; letter-spacing: 2px; margin-bottom: 4px; }
.tagline { text-align: center; font-size: 11px; color: #666; margin-bottom: 24px; letter-spacing: 3px; text-transform: uppercase; }
.section { margin-bottom: 16px; }
.label { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: 1px; margin-bottom: 2px; }
.value { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; white-space: pre-wrap; }
.pw-box { border: 2px dashed #000; padding: 16px; text-align: center; margin: 20px 0; border-radius: 8px; }
.pw-label { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: 1px; margin-bottom: 8px; }
.pw-value { font-family: 'Courier New', monospace; font-size: 28px; font-weight: 900; letter-spacing: 4px; overflow-wrap: anywhere; }
.footer { font-size: 10px; color: #666; text-align: center; margin-top: 24px; line-height: 1.5; border-top: 1px solid #ddd; padding-top: 12px; }
.date { font-size: 10px; color: #999; text-align: center; margin-top: 8px; }
`;

/** Fill `doc` with the slip using DOM nodes and textContent only. */
export function buildPasswordSlipDocument(doc: Document, fields: PasswordSlipFields): void {
  const el = (tag: string, className?: string, text?: string): HTMLElement => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  doc.title = "Sharelebrator Password Reset";
  const style = doc.createElement("style");
  style.textContent = SLIP_CSS;
  doc.head.appendChild(style);

  const body = doc.body;
  body.appendChild(el("div", "brand", "★ SHARELEBRATOR ★"));
  body.appendChild(el("div", "tagline", "Password Reset"));

  const section = (label: string, value: string) => {
    const s = el("div", "section");
    s.appendChild(el("div", "label", label));
    s.appendChild(el("div", "value", value));
    return s;
  };
  body.appendChild(section("Cardholder", String(fields.name ?? "")));
  body.appendChild(section("Phone", String(fields.phone ?? "")));

  const pw = el("div", "pw-box");
  pw.appendChild(el("div", "pw-label", "Temporary Password"));
  pw.appendChild(el("div", "pw-value", String(fields.tempPassword ?? "")));
  body.appendChild(pw);

  body.appendChild(el("div", "footer",
    "Use this password to log in to your Sharelebrator account. Please change your password after logging in for security."));
  body.appendChild(el("div", "date", `Reset on ${fields.resetDate}`));
}

/**
 * Open a blank popup, sever its opener link, build the slip and print it.
 * Returns false when the popup was blocked.
 */
export function printPasswordSlipInPopup(
  openWindow: (url: string, target: string, features: string) => Window | null,
  fields: PasswordSlipFields,
): boolean {
  // "noopener" in the features would make window.open return null (nothing to
  // print into), so the reference is kept here and the popup's link back to
  // this page is cut immediately instead.
  const w = openWindow("", "_blank", "width=420,height=600");
  if (!w) return false;
  try { (w as any).opener = null; } catch { /* ignore */ }
  buildPasswordSlipDocument(w.document, fields);
  try {
    w.addEventListener?.("afterprint", () => w.close());
  } catch { /* ignore */ }
  w.focus?.();
  w.print();
  return true;
}
