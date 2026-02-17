"use client";

import { useState, useEffect, useCallback } from 'react';

const LOG_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes

export function useWeatherLogger() {
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
            if (Date.now() - lastLogTime > LOG_INTERVAL) {
                openModal();
            }
        };

        // Check immediately on mount
        checkTime();
        
        // Then check periodically
        const interval = setInterval(checkTime, CHECK_INTERVAL);
        
        return () => clearInterval(interval);
    }, [openModal]);

    return { isModalOpen, closeModal };
}
