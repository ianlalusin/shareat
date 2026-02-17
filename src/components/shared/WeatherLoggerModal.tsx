"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sun, Cloudy, CloudRain, CloudLightning } from "lucide-react";
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

    const handleLogWeather = async (condition: WeatherCondition) => {
        if (!appUser || !storeId) {
            console.warn("Weather log skipped: User or Store ID is missing.");
            onClose(); // Still close the modal
            return;
        }

        // Immediately close the modal for a non-intrusive experience.
        onClose();

        // Perform the data logging in the background.
        try {
            const now = new Date();
            const dayId = getDayIdFromTimestamp(now);
            
            const activeSessionsRef = collection(db, 'stores', storeId, 'activeSessions');
            const snapshot = await getCountFromServer(activeSessionsRef);
            const activeSessionCount = snapshot.data().count;
            
            // Placeholder for guest count, as it's a more complex aggregation.
            const activeGuestCount = 0; 

            const newEntry: WeatherEntry = {
                timestamp: now, // Firestore handles Date objects
                condition,
                activeSessionCount,
                activeGuestCount,
                loggedByUid: appUser.uid,
            };

            const recordRef = doc(db, 'stores', storeId, 'weatherRecords', dayId);

            // Use setDoc with merge to create the doc if it doesn't exist,
            // and arrayUnion to add the new entry.
            await setDoc(recordRef, {
                dayId,
                entries: arrayUnion(newEntry)
            }, { merge: true });

        } catch (error) {
            // Log error to console without bothering the user.
            console.error("Failed to log weather in the background:", error);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
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
                        >
                            <Icon className="w-8 h-8" />
                            <span>{label}</span>
                        </Button>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
}
