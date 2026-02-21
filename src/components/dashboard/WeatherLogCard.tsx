
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Sun, Cloudy, CloudRain, CloudLightning, Moon } from "lucide-react";
import { db } from "@/lib/firebase/client";
import { doc, onSnapshot } from "firebase/firestore";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import { toJsDate } from "@/lib/utils/date";
import { format } from "date-fns";
import type { WeatherEntry, WeatherRecord } from "@/lib/types";

interface WeatherLogCardProps {
    storeId: string;
}

const weatherIcons: Record<string, React.ElementType> = {
  sunny: Sun,
  cloudy: Cloudy,
  light_rain: CloudRain,
  heavy_rain: CloudLightning,
  clear: Moon, // for night time sunny
};

function getWeatherIcon(condition: string, timestamp: Date): React.ElementType {
    const hour = timestamp.getHours();
    const isNight = hour >= 18 || hour < 6;
    if (condition === 'sunny' && isNight) {
        return weatherIcons['clear'];
    }
    return weatherIcons[condition] || Sun;
}

export function WeatherLogCard({ storeId }: WeatherLogCardProps) {
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
                setEntries(sortedEntries.slice(0, 10));
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
    
    if (isLoading) {
        return (
             <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Weather Log</CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center items-center h-48">
                    <Loader2 className="animate-spin" />
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-base">Today's Weather Log</CardTitle>
                <CardDescription>Last 10 entries.</CardDescription>
            </CardHeader>
            <CardContent>
                {entries.length === 0 ? (
                    <p className="text-center text-sm text-muted-foreground py-10">No weather logged today.</p>
                ) : (
                    <div className="space-y-3">
                        {entries.map((entry, index) => {
                             const entryDate = toJsDate(entry.timestamp);
                             if (!entryDate) return null;

                             const Icon = getWeatherIcon(entry.condition, entryDate);
                             
                             return (
                                <div key={index} className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">{format(entryDate, 'p')}</span>
                                    <Icon className="h-5 w-5" />
                                </div>
                             )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
