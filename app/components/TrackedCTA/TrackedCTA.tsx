'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { IntentEventName } from '../../hooks/useIntentTracking';

interface TrackedCTAProps {
  href: string;
  eventName: IntentEventName;
  className?: string;
  children: React.ReactNode;
}

export default function TrackedCTA({ href, eventName, className, children }: TrackedCTAProps) {
  const events = useRef<{ name: string; timestamp: number }[]>([]);

  const track = useCallback((name: IntentEventName) => {
    const event = { name, timestamp: Date.now() };
    events.current.push(event);
    if (process.env.NODE_ENV === 'development') {
      console.debug('[intent]', name);
    }
  }, []);

  // Listen for Tally form submission
  useEffect(() => {
    if (eventName !== 'pilot_form_opened') return;
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.event === 'Tally.FormSubmitted' && e.data.payload?.formId === 'n0vqEP') {
        track('pilot_form_submitted');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [track, eventName]);

  return (
    <a href={href} className={className} onClick={() => track(eventName)}>
      {children}
    </a>
  );
}
