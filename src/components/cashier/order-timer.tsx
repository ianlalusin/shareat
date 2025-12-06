'use client';

import { useState, useEffect } from 'react';
import type { Timestamp } from 'firebase/firestore';

interface OrderTimerProps {
  startTime: Timestamp | null | undefined;
}

export function OrderTimer({ startTime }: OrderTimerProps) {
  const [elapsedTime, setElapsedTime] = useState('00:00:00');

  useEffect(() => {
    if (!startTime) {
      setElapsedTime('00:00:00');
      return;
    }

    const startDate = startTime.toDate();
    
    const intervalId = setInterval(() => {
      const now = new Date();
      const difference = now.getTime() - startDate.getTime();

      if (difference < 0) {
        setElapsedTime('00:00:00');
        return;
      }

      const hours = Math.floor(difference / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      const formattedTime = [
        String(hours).padStart(2, '0'),
        String(minutes).padStart(2, '0'),
        String(seconds).padStart(2, '0'),
      ].join(':');
      
      setElapsedTime(formattedTime);
    }, 1000);

    return () => clearInterval(intervalId);

  }, [startTime]);

  return <p><span className="font-semibold">Time:</span> {elapsedTime}</p>;
}
