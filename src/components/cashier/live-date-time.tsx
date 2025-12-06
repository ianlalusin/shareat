'use client';

import { useState, useEffect } from 'react';

export function LiveDateTime() {
  const [currentDateTime, setCurrentDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const formattedDate = currentDateTime.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const formattedTime = currentDateTime.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="hidden md:flex flex-col items-start text-primary-foreground">
      <p className="font-semibold text-sm leading-none">{formattedDate}</p>
      <p className="text-xs leading-none">{formattedTime}</p>
    </div>
  );
}
