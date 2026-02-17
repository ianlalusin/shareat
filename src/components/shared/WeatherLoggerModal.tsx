"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Sun, Cloudy, CloudRain, CloudLightning } from "lucide-react";
import { useAuthContext } from "@/context/auth-context";
import { db } from "@/lib/firebase/client";
import { doc, setDoc, arrayUnion, getCountFromServer, collection } from "firebase/firestore";
import { getDayIdFromTimestamp } from "@/lib/analytics/daily";
import type { WeatherCondition, WeatherEntry } from "@/lib/types";

interface WeatherLoggerModalProps {
    isOpen: boolean;
    onClose: () => void;
    storeId: string;
}

const weatherOptions: { label: string; value: WeatherCondition; icon: React.ElementType }[] = [
    { label: "Sunny", value: "sunny", icon: Sun },
    { label: "Cloudy", value: "cloudy", icon: Cloudy },
    { label: "Light Rain", value: "light_rain", icon: CloudRain },
    { label: "Heavy Rain", value: "heavy_rain", icon: CloudLightning },
];

export function WeatherLoggerModal({ isOpen, onClose, storeId }: WeatherLoggerModalProps) {
    const { appUser } = useAuthContext();
    const [isLoading, setIsLoading] = useState(false);

    const handleLogWeather = async (condition: WeatherCondition) => {
        if (!appUser || !storeId) {
            console.error("User or store ID is missing.");
            return;
        }

        setIsLoading(true);
        try {
            const now = new Date();
            const dayId = getDayIdFromTimestamp(now);
            
            // Fetch active sessions to get counts
            const activeSessionsRef = collection(db, 'stores', storeId, 'activeSessions');
            const snapshot = await getCountFromServer(activeSessionsRef);
            const activeSessionCount = snapshot.data().count;
            
            // Note: Guest count snapshot is more complex and might require a separate query/aggregation.
            // For simplicity, we'll placeholder it for now. This could be improved later.
            const activeGuestCount = 0; // Placeholder

            const newEntry: WeatherEntry = {
                timestamp: now as any, // Firestore will convert it
                condition,
                activeSessionCount,
                activeGuestCount,
                loggedByUid: appUser.uid,
            };

            const recordRef = doc(db, 'stores', storeId, 'weatherRecords', dayId);

            // Use setDoc with merge to create the doc if it doesn't exist,
            // and arrayUnion to add the new entry without overwriting others.
            await setDoc(recordRef, {
                dayId,
                entries: arrayUnion(newEntry)
            }, { merge: true });

            onClose();
        } catch (error) {
            console.error("Failed to log weather:", error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle>Quick Weather Update</DialogTitle>
                    <DialogDescription>
                        How's the weather right now? Your input helps improve sales forecasting.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 py-4">
                    {weatherOptions.map(({ label, value, icon: Icon }) => (
                        <Button
                            key={value}
                            variant="outline"
                            className="h-20 flex flex-col gap-2"
                            onClick={() => handleLogWeather(value)}
                            disabled={isLoading}
                        >
                            {isLoading ? <Loader2 className="animate-spin" /> : <Icon className="w-8 h-8" />}
                            <span>{label}</span>
                        </Button>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}