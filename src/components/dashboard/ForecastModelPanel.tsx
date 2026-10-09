"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useForecastModel } from "@/hooks/useForecastModel";
import { bias, wape } from "@/lib/forecast/model";

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

const peso = (v: number) => `₱${Math.round(v).toLocaleString("en-PH")}`;

/**
 * One compact line on the forecast card; the drivers, model-vs-AI comparison
 * and weekly reasoning live in a side sheet so the dashboard stays uncluttered.
 */
export function ForecastModelPanel({ storeId, drivers, modelSales, engine }: {
  storeId?: string;
  drivers?: string[] | null;
  modelSales?: number | null;
  engine?: "llm" | "model" | null;
}) {
  const [open, setOpen] = useState(false);
  const { model } = useForecastModel(storeId);
  const compared = model?.accuracy.model.n ?? 0;
  const showDrivers = !!drivers && drivers.length > 0 && (engine === "model" || typeof modelSales === "number");
  const showComparison = !!model && compared > 0;
  if (!showDrivers && !showComparison && !model?.reasoning) return null;

  const summary =
    engine === "model"
      ? "Forecast by the learned model"
      : typeof modelSales === "number"
        ? `Learned model: ${peso(modelSales)}`
        : "Learned model insights";

  return (
    <>
      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2 text-sm">
        <span className="text-muted-foreground">{summary}</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => setOpen(true)}>
          <Info className="h-4 w-4" />
          Why?
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Learned forecast model</SheetTitle>
            <SheetDescription>What the model learned from this branch&apos;s own sales.</SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-5 text-sm">
            {showDrivers && drivers && (
              <section>
                <div className="font-medium">
                  {engine === "model" ? "Why today's number" : `Today: ${peso(modelSales as number)}`}
                </div>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {drivers.map((d, i) => <li key={`${i}-${d}`}>{d}</li>)}
                </ul>
              </section>
            )}

            {model && showComparison && (
              <section className="grid grid-cols-2 gap-2">
                <div><div className="text-muted-foreground">Learned model error</div><div className="font-mono">{pct(wape(model.accuracy.model))} <span className="text-xs text-muted-foreground">bias {pct(bias(model.accuracy.model))}</span></div></div>
                <div><div className="text-muted-foreground">AI forecast error</div><div className="font-mono">{pct(wape(model.accuracy.llm))} <span className="text-xs text-muted-foreground">bias {pct(bias(model.accuracy.llm))}</span></div></div>
                <div className="col-span-2 text-xs text-muted-foreground">Compared over {compared} day{compared === 1 ? "" : "s"}{engine === "model" ? " (as of switch to learned model)" : ""} · lower is better</div>
              </section>
            )}

            {model?.reasoning && (
              <section>
                <div className="font-medium">What drives this branch</div>
                <p className="mt-1 text-muted-foreground">{model.reasoning.summary}</p>
                {model.reasoning.flags.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {model.reasoning.flags.map((f, i) => <li key={`${i}-${f}`}>{f}</li>)}
                  </ul>
                )}
                <div className="mt-2 text-xs text-muted-foreground">
                  Reviewed {new Date(model.reasoning.generatedAt).toLocaleDateString("en-PH")} by {model.reasoning.provider === "claude" ? "Claude" : "Gemini"}
                </div>
              </section>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
