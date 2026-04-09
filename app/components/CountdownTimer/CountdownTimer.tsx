'use client';

import { useState, useEffect } from 'react';
import styles from './CountdownTimer.module.css';

const DEADLINE = new Date('2026-08-15T23:59:59+02:00');

function getTimeLeft() {
  const diff = DEADLINE.getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
  };
}

const UNITS = ['days', 'hours', 'minutes', 'seconds'] as const;

export default function CountdownTimer() {
  const [timeLeft, setTimeLeft] = useState<ReturnType<typeof getTimeLeft> | null>(null);

  useEffect(() => {
    setTimeLeft(getTimeLeft());
    const id = setInterval(() => setTimeLeft(getTimeLeft()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!timeLeft) return <div className={styles.timer} />;

  return (
    <div className={styles.timer}>
      {UNITS.map((unit) => (
        <div key={unit} className={styles.unit}>
          <span className={styles.value}>
            {String(timeLeft[unit]).padStart(2, '0')}
          </span>
          <span className={styles.label}>{unit}</span>
        </div>
      ))}
    </div>
  );
}
