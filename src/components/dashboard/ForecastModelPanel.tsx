"use client";

import { useForecastModel } from "@/hooks/useForecastModel";
import { bias, wape } from "@/lib/forecast/model";

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

const peso = (v: number) => `₱${Math.round(v).toLocaleString("en-PH")}`;

export function ForecastModelPanel({ storeId, drivers, modelSales, engine }: {
  storeId?: string;
  drivers?: string[] | null;
  modelSales?: number | null;
  engine?: "llm" | "model" | null;
}) {
  const { model } = useForecastModel(storeId);
  const compared = model?.accuracy.model.n ?? 0;
  const showDrivers = !!drivers && drivers.length > 0 && (engine === "model" || typeof modelSales === "number");
  const showComparison = !!model && compared > 0;
  if (!showDrivers && !showComparison && !model?.reasoning) return null;

  return (
    <div className="mt-4 space-y-3 border-t pt-3 text-sm">
      {showDrivers && drivers && (
        <div>
          <div className="font-medium">{engine === "model" ? "Why today's number" : `Learned model: ${peso(modelSales as number)} — why`}</div>
          <ul className="mt-1 list-disc pl-5 text-muted-foreground">
            {drivers.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </div>
      )}
      {model && showComparison && (
        <div className="grid grid-cols-2 gap-2">
          <div><div className="text-muted-foreground">Learned model error</div><div className="font-mono">{pct(wape(model.accuracy.model))} <span className="text-xs text-muted-foreground">bias {pct(bias(model.accuracy.model))}</span></div></div>
          <div><div className="text-muted-foreground">AI forecast error</div><div className="font-mono">{pct(wape(model.accuracy.llm))} <span className="text-xs text-muted-foreground">bias {pct(bias(model.accuracy.llm))}</span></div></div>
          <div className="col-span-2 text-xs text-muted-foreground">Compared over {compared} day{compared === 1 ? "" : "s"}{engine === "model" ? " (as of switch to learned model)" : ""} · lower is better</div>
        </div>
      )}
      {model?.reasoning && (
        <div>
          <div className="font-medium">What drives this branch</div>
          <p className="mt-1 text-muted-foreground">{model.reasoning.summary}</p>
          {model.reasoning.flags.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {model.reasoning.flags.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            Reviewed {new Date(model.reasoning.generatedAt).toLocaleDateString("en-PH")} by {model.reasoning.provider === "claude" ? "Claude" : "Gemini"}
          </div>
        </div>
      )}
    </div>
  );
}
