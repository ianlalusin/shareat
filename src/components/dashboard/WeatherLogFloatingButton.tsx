
'use client';

import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Sun, Cloudy, CloudRain, CloudLightning, Moon, CloudSun } from "lucide-react";
import { db } from "@/lib/firebase/client";
import { doc, onSnapshot } from "firebase/firestore";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { toJsDate } from "@/lib/utils/date";
import { format } from "date-fns";
import type { WeatherEntry, WeatherRecord } from "@/lib/types";
import { Skeleton } from "../ui/skeleton";

const weatherIcons: Record<string, React.ElementType> = {
  sunny: Sun,
  cloudy: Cloudy,
  light_rain: CloudRain,
  heavy_rain: CloudLightning,
  clear: Moon, // for night time sunny
};

function getWeatherIcon(condition: string, timestamp?: Date): React.ElementType {
    const ts = timestamp || new Date();
    const hour = ts.getHours();
    const isNight = hour >= 18 || hour < 6;
    if (condition === 'sunny' && isNight) {
        return weatherIcons['clear'];
    }
    return weatherIcons[condition] || CloudSun;
}


export function WeatherLogFloatingButton({ storeId }: { storeId: string }) {
    const [entries, setEntries] = useState<WeatherEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!storeId) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        const dayId = getDayIdFromTimestamp(new Date());
        const recordRef = doc(db, 'stores', storeId, 'weatherRecords', dayId);

        const unsubscribe = onSnapshot(recordRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data() as WeatherRecord;
                const sortedEntries = (data.entries || []).sort((a, b) => {
                    const timeA = toJsDate(a.timestamp)?.getTime() || 0;
                    const timeB = toJsDate(b.timestamp)?.getTime() || 0;
                    return timeB - timeA;
                });
                setEntries(sortedEntries); // Keep all entries for the modal
            } else {
                setEntries([]);
            }
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching weather logs:", error);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [storeId]);

    const latestEntry = entries.length > 0 ? entries[0] : null;
    const LatestIcon = latestEntry ? getWeatherIcon(latestEntry.condition, toJsDate(latestEntry.timestamp) ?? undefined) : CloudSun;

    return (
        <Sheet>
            <SheetTrigger asChild>
                <Button 
                    className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
                    size="icon"
                    aria-label="View weather logs"
                >
                    {isLoading ? <Skeleton className="h-8 w-8 rounded-full" /> : <LatestIcon className="h-8 w-8" />}
                </Button>
            </SheetTrigger>
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>Today's Weather Log</SheetTitle>
                    <SheetDescription>
                        A log of weather conditions recorded today.
                    </SheetDescription>
                </SheetHeader>
                <div className="py-4">
                    {entries.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-10">No weather logged today.</p>
                    ) : (
                        <div className="space-y-4">
                            {entries.slice(0, 10).map((entry, index) => {
                                const entryDate = toJsDate(entry.timestamp);
                                if (!entryDate) return null;

                                const Icon = getWeatherIcon(entry.condition, entryDate);
                                
                                return (
                                    <div key={index} className="flex items-center justify-between text-sm p-2 border-b">
                                        <span className="text-muted-foreground">{format(entryDate, 'p')}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="capitalize font-medium">{entry.condition.replace('_', ' ')}</span>
                                            <Icon className="h-5 w-5" />
                                        </div>
                                    </div>
                                )
                            })}
                            {entries.length > 10 && <p className="text-center text-xs text-muted-foreground mt-4">Showing last 10 entries.</p>}
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
