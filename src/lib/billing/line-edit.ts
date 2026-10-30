import * as z from "zod";
import type { Charge, Discount, LineAdjustment, SessionBillLine } from "@/lib/types";
import { validateChargeValue, validateDiscountValue } from "./adjustment-validation";

/**
 * Line editor schema + single-command builder (audits F09 / F25).
 *
 * F09: discount/charge values go through the shared validators, errors are
 * attached to the value field (discountValue / chargeValue).
 * F25: Save Changes is ONE command — the core line patch plus every new
 * adjustment — committed in one Firestore transaction/batch by the caller.
 * Adjustment IDs come from `LineEditOpIds`, created once per editing attempt
 * and reused across retries, so a retry rewrites the same map key instead of
 * appending a second discount.
 */

export function makeLineEditSchema(opts: { discountEligibleUnit?: number | null } = {}) {
  return z
    .object({
      qtyOrdered: z.coerce.number().finite().min(0, "Quantity must be non-negative."),
      unitPrice: z.coerce.number().finite().min(0),

      applyDiscount: z.boolean().default(false),
      discountId: z.string().optional(),
      discountType: z.enum(["fixed", "percent"]).nullable().optional(),
      discountValue: z.coerce.number().default(0),
      discountQty: z.coerce.number().finite().min(0),

      applyCharge: z.boolean().default(false),
      chargeId: z.string().optional(),
      chargeType: z.enum(["fixed", "percent"]).nullable().optional(),
      chargeValue: z.coerce.number().default(0),
      chargeQty: z.coerce.number().finite().min(0),

      applyFree: z.boolean().default(false),
      freeQty: z.coerce.number().finite().min(0),

      applyVoid: z.boolean().default(false),
      voidQty: z.coerce.number().finite().min(0),
      voidReason: z.string().optional(),
      voidNote: z.string().optional(),
      note: z.string().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.applyDiscount) {
        if (!data.discountId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountId"], message: "Select a preset or Custom." });
        }
        const err = validateDiscountValue(data.discountType, data.discountValue, opts.discountEligibleUnit);
        if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountValue"], message: err });
        if (!(data.discountQty > 0)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountQty"], message: "Apply the discount to at least 1 item." });
        }
      }
      if (data.applyCharge) {
        if (!data.chargeId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chargeId"], message: "Select a preset or Custom." });
        }
        const err = validateChargeValue(data.chargeType, data.chargeValue);
        if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chargeValue"], message: err });
        if (!(data.chargeQty > 0)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chargeQty"], message: "Apply the charge to at least 1 item." });
        }
      }
    });
}

export type LineEditFormValues = z.infer<ReturnType<typeof makeLineEditSchema>>;

/** Stable IDs for one logical edit; reused across retries of the same edit. */
export type LineEditOpIds = {
  discountAdjId: string;
  chargeAdjId: string;
  createdAtClientMs: number;
};

export function newLineEditOpIds(now: number = Date.now()): LineEditOpIds {
  const rand = () =>
    typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function"
      ? (crypto as any).randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return {
    discountAdjId: `adj_${now}_${rand()}`,
    chargeAdjId: `adj_${now}_${rand()}`,
    createdAtClientMs: now,
  };
}

export type LineEditCommand = {
  before: Partial<SessionBillLine>;
  after: Partial<SessionBillLine>;
  adjustments: LineAdjustment[];
};

export function buildLineEditCommand(args: {
  line: SessionBillLine;
  data: LineEditFormValues;
  discounts: Discount[];
  charges: Charge[];
  actor: { uid: string; name?: string | null };
  opIds: LineEditOpIds;
  isPackage?: boolean;
}): LineEditCommand {
  const { line, data, discounts, charges, actor, opIds, isPackage } = args;

  const before: Partial<SessionBillLine> = {
    qtyOrdered: line.qtyOrdered,
    unitPrice: line.unitPrice,
    freeQty: line.freeQty,
    voidedQty: line.voidedQty,
    note: line.note ?? null,
  };

  const after: Partial<SessionBillLine> = {
    qtyOrdered: data.qtyOrdered,
    unitPrice: data.unitPrice,
    freeQty: data.applyFree ? data.freeQty : 0,
    voidedQty: data.applyVoid ? data.voidQty : 0,
    note: (data.note ?? "").trim() || null,
  };
  if (isPackage && data.qtyOrdered > line.qtyOrdered) {
    (after as any).qtyOverrideActive = true;
    (after as any).qtyOverrideAt = new Date();
  }

  const adjustments: LineAdjustment[] = [];
  const createdByName = actor.name || undefined;

  if (data.applyDiscount && data.discountQty > 0 && data.discountValue > 0 && data.discountType) {
    const preset = discounts.find((d) => d.id === data.discountId);
    adjustments.push({
      id: opIds.discountAdjId,
      kind: "discount",
      note: preset?.name || "Custom Discount",
      type: data.discountType,
      value: data.discountValue,
      qty: data.discountQty,
      refId: data.discountId !== "custom" ? data.discountId ?? null : null,
      stackable: preset?.stackable ?? true,
      createdAtClientMs: opIds.createdAtClientMs,
      createdByUid: actor.uid,
      ...(createdByName ? { createdByName } : {}),
    });
  }

  if (data.applyCharge && data.chargeQty > 0 && data.chargeValue > 0 && data.chargeType) {
    const preset = charges.find((c) => c.id === data.chargeId);
    adjustments.push({
      id: opIds.chargeAdjId,
      kind: "charge",
      note: preset?.name || "Custom Charge",
      type: data.chargeType,
      value: data.chargeValue,
      qty: data.chargeQty,
      refId: data.chargeId !== "custom" ? data.chargeId ?? null : null,
      createdAtClientMs: opIds.createdAtClientMs + 1,
      createdByUid: actor.uid,
      ...(createdByName ? { createdByName } : {}),
    });
  }

  return { before, after, adjustments };
}

/**
 * Firestore update payload for the bill-line doc: core fields plus each new
 * adjustment under its stable `lineAdjustments.<id>` key. Writing the same
 * command twice produces the same document (idempotent).
 */
export function lineEditUpdateFields(
  after: Partial<SessionBillLine>,
  adjustments: LineAdjustment[],
): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...after };
  for (const adj of adjustments) fields[`lineAdjustments.${adj.id}`] = adj;
  return fields;
}

/** Local (non-Firestore) application of a command, used by the receipt editor. */
export function applyLineEditLocally(
  line: SessionBillLine,
  after: Partial<SessionBillLine>,
  adjustments: LineAdjustment[],
): SessionBillLine {
  const map = { ...(((line as any).lineAdjustments ?? {}) as Record<string, LineAdjustment>) };
  for (const adj of adjustments) map[adj.id] = adj;
  return { ...line, ...after, lineAdjustments: map } as SessionBillLine;
}
