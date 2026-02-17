
"use client";

import { useState, useEffect, useCallback } from 'react';
import { useStoreContext } from '@/context/store-context';

const LOG_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes

export function useWeatherLogger() {
    const { activeStore } = useStoreContext();
    const [isModalOpen, setIsModalOpen] = useState(false);

    const openModal = useCallback(() => {
        // Prevent opening if another modal-like element is already present
        if (document.querySelector('[data-radix-popper-content-wrapper]')) {
            return;
        }
        setIsModalOpen(true);
    }, []);

    const closeModal = useCallback(() => {
        localStorage.setItem('lastWeatherLogTime', Date.now().toString());
        setIsModalOpen(false);
    }, []);

    useEffect(() => {
        const checkTime = () => {
            const lastLogTime = parseInt(localStorage.getItem('lastWeatherLogTime') || '0', 10);
            if (Date.now() - lastLogTime < LOG_INTERVAL) {
                return; // Don't show if logged recently
            }

            // If no store hours are set, show the modal as before.
            if (!activeStore || !activeStore.openingTime || !activeStore.closingTime) {
                openModal();
                return;
            }

            // Check if within store hours
            try {
                // Use store's timezone, assuming Asia/Manila for this app
                const nowInStoreTz = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
                const currentTimeInMinutes = nowInStoreTz.getHours() * 60 + nowInStoreTz.getMinutes();

                const [startHour, startMinute] = activeStore.openingTime.split(':').map(Number);
                const startTimeInMinutes = startHour * 60 + startMinute;

                const [endHour, endMinute] = activeStore.closingTime.split(':').map(Number);
                const endTimeInMinutes = endHour * 60 + endMinute;
                
                if (isNaN(startTimeInMinutes) || isNaN(endTimeInMinutes)) {
                    throw new Error("Invalid time format in store settings.");
                }
                
                let isInHours = false;
                if (startTimeInMinutes <= endTimeInMinutes) { // Same day (e.g., 09:00 - 22:00)
                    isInHours = currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes < endTimeInMinutes;
                } else { // Overnight (e.g., 21:00 - 05:00)
                    isInHours = currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes < endTimeInMinutes;
                }
                
                if (isInHours) {
                    openModal();
                }

            } catch (error) {
                console.error("Error parsing store hours for weather logger:", error);
                // Fallback to showing the modal if parsing fails, to not lose data.
                openModal();
            }
        };

        // Check immediately on mount
        checkTime();
        
        // Then check periodically
        const interval = setInterval(checkTime, CHECK_INTERVAL);
        
        return () => clearInterval(interval);
    }, [openModal, activeStore]);

    return { isModalOpen, closeModal };
}
