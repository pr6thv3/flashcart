'use client';

import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface CountdownTimerProps {
  endsAt: string;
}

export function CountdownTimer({ endsAt }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<{ hours: number; minutes: number; seconds: number; ended: boolean }>({
    hours: 0,
    minutes: 0,
    seconds: 0,
    ended: false,
  });

  useEffect(() => {
    function calculate() {
      const difference = new Date(endsAt).getTime() - new Date().getTime();
      if (difference <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0, ended: true });
        return;
      }

      const hours = Math.floor(difference / (1000 * 60 * 60));
      const minutes = Math.floor((difference / 1000 / 60) % 60);
      const seconds = Math.floor((difference / 1000) % 60);

      setTimeLeft({ hours, minutes, seconds, ended: false });
    }

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  if (timeLeft.ended) {
    return (
      <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-500">
        Sale Ended
      </span>
    );
  }

  const pad = (n: number) => n.toString().padStart(2, '0');

  return (
    <div className="inline-flex items-center space-x-1 font-mono text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
      <Clock className="w-3.5 h-3.5 animate-spin-slow" />
      <span>
        {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
      </span>
    </div>
  );
}
