
export const UOM_OPTIONS = [
  { value: "pcs", label: "pcs" },
  { value: "kg",  label: "kg"  },
  { value: "lit", label: "lit" },
  { value: "box", label: "box" },
  { value: "gal", label: "gal" },
] as const;

export type Uom = typeof UOM_OPTIONS[number]['value'];

const UOM_VALUES = UOM_OPTIONS.map(opt => opt.value);

const NORMALIZATION_MAP: Record<string, Uom> = {
  "pc": "pcs",
  "piece": "pcs",
  "pieces": "pcs",
  "l": "lit",
  "liter": "lit",
  "litre": "lit",
  "gallon": "gal",
  "gal.": "gal",
  "kilogram": "kg",
  "kgs": "kg",
  "box": "box",
  "boxes": "box",
};

export function normalizeUom(input: unknown): Uom {
  if (typeof input !== 'string') {
    return "pcs";
  }
  const lowerInput = input.toLowerCase().trim();
  if ((UOM_VALUES as readonly string[]).includes(lowerInput)) {
    return lowerInput as Uom;
  }
  return NORMALIZATION_MAP[lowerInput] || "pcs";
}

const DECIMAL_UOMS: Uom[] = ["kg", "lit", "gal"];

export function allowsDecimalQty(uom: unknown): boolean {
  if (typeof uom !== 'string') {
    return false;
  }
  const normalized = normalizeUom(uom);
  return DECIMAL_UOMS.includes(normalized);
}
