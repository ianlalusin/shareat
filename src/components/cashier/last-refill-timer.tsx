
'use client';

import { useState, useEffect } from 'react';
import type { Timestamp } from 'firebase/firestore';

interface LastRefillTimerProps {
  refillTime: Timestamp | null | undefined;
}

export function LastRefillTimer({ refillTime }: LastRefillTimerProps) {
  const [elapsedTime, setElapsedTime] = useState('00:00:00');

  useEffect(() => {
    if (!refillTime) {
      setElapsedTime('--:--:--');
      return;
    }

    const refillDate = refillTime.toDate();
    
    const intervalId = setInterval(() => {
      const now = new Date();
      const difference = now.getTime() - refillDate.getTime();

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

  }, [refillTime]);

  return <p><span className="font-semibold">Time Since:</span> {elapsedTime}</p>;
}
