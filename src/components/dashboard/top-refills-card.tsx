
"use client";

import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, orderBy, Timestamp, doc, getDocs, limit, type DocumentReference } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DailyMetric } from "@/lib/types";

// --- Helper Types & Functions ---

type RefillAgg = { refillName: string; qty: number; };

function mergeRefillAgg(target: Map<string, RefillAgg>, row: any) {
  const key = row.refillName;
  const cur = target.get(key) ?? { refillName: row.refillName, qty: 0 };
  cur.qty += row.qty ?? 0;
  target.set(key, cur);
}

async function fetchTopRefillsForRollupDocs(
  rollupDocRefs: DocumentReference[],
  topN = 10
): Promise<RefillAgg[]> {
  const merged = new Map<string, RefillAgg>();

  await Promise.all(
    rollupDocRefs.map(async (ref) => {
      const itemsRef = collection(ref, "refillItems");
      const q = query(itemsRef, orderBy("qty", "desc"), limit(topN));
      const snap = await getDocs(q);
      snap.forEach((d) => mergeRefillAgg(merged, d.data()));
    })
  );

  return Array.from(merged.values()).sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0));
}

// --- Component ---

interface TopRefillsCardProps {
  storeId: string;
  dateRange: { start: Date; end: Date };
  topN?: number;
}

export function TopRefillsCard({ storeId, dateRange, topN = 5 }: TopRefillsCardProps) {
    const [topRefills, setTopRefills] = useState<RefillAgg[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!storeId) {
            setIsLoading(false);
            setTopRefills([]);
            return;
        }
        setIsLoading(true);

        const startMs = dateRange.start.getTime();
        const endMs = dateRange.end.getTime();

        const metricsRef = collection(db, "stores", storeId, "analytics");
        const q = query(
            metricsRef,
            where("meta.dayStartMs", ">=", startMs),
            where("meta.dayStartMs", "<=", endMs),
            orderBy("meta.dayStartMs", "asc")
        );

        const unsubscribe = onSnapshot(
            q,
            async (snapshot) => {
              try {
                const fetchedMetrics = snapshot.docs.map((d) => d.data() as DailyMetric);
        
                // Build doc refs for each day analytics doc
                const dayRefs = fetchedMetrics
                  .map((m) => m?.meta?.dayId)
                  .filter(Boolean)
                  .map((dayId) => doc(db, "stores", storeId, "analytics", dayId as string));
        
                const topN = 50; // Fetch more for "View All"
                const items = await fetchTopRefillsForRollupDocs(dayRefs, topN);
        
                setTopRefills(items);
              } catch (err) {
                console.error("Error fetching top refills:", err);
                setTopRefills([]);
              } finally {
                setIsLoading(false);
              }
            },
            (error) => {
              console.error("Error fetching refill analytics:", error);
              setIsLoading(false);
            }
          );

        return () => unsubscribe();
    }, [storeId, dateRange]);

    const displayRefills = topRefills.slice(0, topN);

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Top Refills</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
                </CardContent>
            </Card>
        );
    }
    
    if (topRefills.length === 0) {
        return (
             <Card>
                <CardHeader>
                    <CardTitle>Top Refills</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-center text-sm text-muted-foreground py-10">No refill data in this range.</p>
                </CardContent>
            </Card>
        )
    }
    
    return (
        <Sheet>
            <Card>
                <CardHeader>
                     <div className="flex justify-between items-center">
                        <div>
                            <CardTitle>Top Refills by Quantity</CardTitle>
                            <CardDescription>Most frequently served refill items.</CardDescription>
                        </div>
                        <SheetTrigger asChild>
                            <Button variant="outline" size="sm">View All</Button>
                        </SheetTrigger>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Refill</TableHead>
                                <TableHead className="text-right">Total Served</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {displayRefills.map(refill => (
                                <TableRow key={refill.refillName}>
                                    <TableCell className="font-medium">{refill.refillName}</TableCell>
                                    <TableCell className="text-right font-mono">{refill.qty.toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <SheetContent className="w-full sm:max-w-lg flex flex-col">
                <SheetHeader>
                    <SheetTitle>All Refill Analytics</SheetTitle>
                    <SheetDescription>Complete breakdown of served refills for the selected period.</SheetDescription>
                </SheetHeader>
                <ScrollArea className="flex-1">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Refill</TableHead>
                                <TableHead className="text-right">Total Served</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {topRefills.map(refill => (
                                <TableRow key={refill.refillName}>
                                    <TableCell className="font-medium">{refill.refillName}</TableCell>
                                    <TableCell className="text-right font-mono">{refill.qty.toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
