'use client';

import { useState, useEffect } from 'react';

export function LiveDateTime() {
  const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);

  useEffect(() => {
    // Set the initial date/time only on the client
    setCurrentDateTime(new Date());

    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  if (!currentDateTime) {
    // Render nothing or a placeholder on the server and during initial client render
    return (
      <div className="hidden md:flex flex-col items-start text-primary-foreground">
        <p className="font-semibold text-sm leading-none h-5 w-36 bg-primary-foreground/20 animate-pulse rounded-sm"></p>
        <p className="text-xs leading-none h-4 w-20 mt-1 bg-primary-foreground/20 animate-pulse rounded-sm"></p>
      </div>
    );
  }

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
