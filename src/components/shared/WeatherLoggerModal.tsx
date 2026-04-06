"use client";

import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sun, Cloudy, CloudRain, CloudLightning, Moon } from "lucide-react";
import { useAuthContext } from "@/context/auth-context";
import { db } from "@/lib/firebase/client";
import { doc, setDoc, arrayUnion, getCountFromServer, collection, Timestamp } from "firebase/firestore";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import type { WeatherCondition, WeatherEntry } from "@/lib/types";

interface WeatherLoggerModalProps {
    isOpen: boolean;
    onClose: () => void;
    storeId: string;
}

const baseWeatherOptions: { label: string; value: WeatherCondition; icon: React.ElementType; gradient: string; iconColor: string }[] = [
    { label: "Sunny", value: "sunny", icon: Sun, gradient: "from-amber-400 to-orange-500", iconColor: "text-white" },
    { label: "Cloudy", value: "cloudy", icon: Cloudy, gradient: "from-slate-300 to-slate-500", iconColor: "text-white" },
    { label: "Light Rain", value: "light_rain", icon: CloudRain, gradient: "from-sky-400 to-blue-600", iconColor: "text-white" },
    { label: "Heavy Rain", value: "heavy_rain", icon: CloudLightning, gradient: "from-indigo-500 to-purple-700", iconColor: "text-white" },
];

const nightSunnyOverride = { label: "Clear", icon: Moon, gradient: "from-indigo-900 to-slate-800", iconColor: "text-amber-300" };

function isNightTime(): boolean {
    const hour = new Date().getHours();
    return hour >= 18 || hour < 6;
}

export function WeatherLoggerModal({ isOpen, onClose, storeId }: WeatherLoggerModalProps) {
    const { appUser } = useAuthContext();

    const weatherOptions = useMemo(() => {
        if (isNightTime()) {
            return baseWeatherOptions.map(option =>
                option.value === 'sunny'
                    ? { ...option, ...nightSunnyOverride }
                    : option
            );
        }
        return baseWeatherOptions;
    }, []);

    const handleLogWeather = async (condition: WeatherCondition) => {
        if (!appUser || !storeId) {
            onClose();
            return;
        }

        onClose();

        try {
            const now = new Date();
            const dayId = getDayIdFromTimestamp(now);

            const activeSessionsRef = collection(db, 'stores', storeId, 'activeSessions');
            const snapshot = await getCountFromServer(activeSessionsRef);
            const activeSessionCount = snapshot.data().count;
            const activeGuestCount = 0;

            const newEntry: WeatherEntry = {
                timestamp: Timestamp.fromDate(now),
                condition,
                activeSessionCount,
                activeGuestCount,
                loggedByUid: appUser.uid,
            };

            const recordRef = doc(db, 'stores', storeId, 'weatherRecords', dayId);
            await setDoc(recordRef, {
                dayId,
                entries: arrayUnion(newEntry)
            }, { merge: true });

        } catch (error) {
            console.error("Failed to log weather:", error);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Quick Weather Update</DialogTitle>
                    <DialogDescription>
                        How's the weather right now? This helps improve sales forecasting.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 py-3">
                    {weatherOptions.map(({ label, value, icon: Icon, gradient, iconColor }) => (
                        <button
                            key={value}
                            className={`relative h-24 rounded-xl bg-gradient-to-br ${gradient} flex flex-col items-center justify-center gap-2 shadow-md hover:shadow-lg hover:scale-[1.03] active:scale-[0.97] transition-all duration-150 cursor-pointer border-0 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary`}
                            onClick={() => handleLogWeather(value)}
                        >
                            <Icon className={`h-9 w-9 ${iconColor} drop-shadow-sm`} strokeWidth={1.8} />
                            <span className="text-sm font-semibold text-white drop-shadow-sm">{label}</span>
                        </button>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
