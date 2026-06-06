"use client";

import { useState } from "react";
import { getAuth } from "firebase/auth";
import { RoleGuard } from "@/components/guards/RoleGuard";
import { PageHeader } from "@/components/page-header";
import { useStoreContext } from "@/context/store-context";
import { useDailyInsight } from "@/hooks/useDailyInsight";
import { InsightReport } from "@/components/insights/InsightReport";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";

export default function AiInsightsPage() {
  const { activeStore } = useStoreContext();
  const { insight, isLoading } = useDailyInsight(activeStore?.id);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const generate = async (force: boolean) => {
    const user = getAuth().currentUser;
    if (!user || !activeStore) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storeId: activeStore.id, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Generation failed");
      if (json.cached) toast({ title: "Already up to date", description: "Showing the latest generated insight." });
      else if (json.status === "no_data") toast({ title: "No sales yesterday", description: "Nothing to analyze for the day." });
      else toast({ title: "Insight generated" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Generation failed", description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const hasInsight = !!insight && insight.status !== "error";

  return (
    <RoleGuard allow={["admin", "manager"]}>
      <PageHeader title="AI Daily Insights" description="Yesterday's performance, analyzed — for the active store." />
      <div className="mx-auto w-full max-w-4xl px-4 py-4 space-y-4">
        <div className="flex items-center justify-end gap-2">
          {!hasInsight && !isLoading && (
            <Button onClick={() => generate(false)} disabled={busy || !activeStore}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Generate insight
            </Button>
          )}
          {hasInsight && (
            <Button variant="outline" onClick={() => generate(true)} disabled={busy || !activeStore}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Regenerate
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-4 sm:p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : hasInsight ? (
              <InsightReport insight={insight!} />
            ) : (
              <div className="py-12 text-center space-y-3">
                <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No insight generated yet for yesterday.</p>
                <Button onClick={() => generate(false)} disabled={busy || !activeStore}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Generate now
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </RoleGuard>
  );
}
