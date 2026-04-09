'use client';

import { useCallback, useEffect, useRef } from 'react';

export type IntentEventName =
  | 'catalogue_section_viewed'
  | 'catalogue_dropdown_opened'
  | 'catalogue_subject_selected'
  | 'catalogue_preview_viewed'
  | 'catalogue_form_opened'
  | 'catalogue_form_submitted'
  | 'pilot_form_opened'
  | 'pilot_form_submitted';

interface IntentEvent {
  name: IntentEventName;
  timestamp: number;
  meta?: Record<string, string>;
}

export function useIntentTracking() {
  const events = useRef<IntentEvent[]>([]);

  const track = useCallback((name: IntentEventName, meta?: Record<string, string>) => {
    const event: IntentEvent = { name, timestamp: Date.now(), meta };
    events.current.push(event);
    if (process.env.NODE_ENV === 'development') {
      console.debug('[intent]', event.name, meta ?? '');
    }
  }, []);

  // Listen for Tally form submission postMessages
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      // Tally sends { event: 'Tally.FormSubmitted', payload: { formId: '...' } }
      if (e.data.event === 'Tally.FormSubmitted') {
        const formId: string = e.data.payload?.formId ?? '';
        if (formId) {
          // Distinguish catalogue vs pilot form submissions by form ID prefix
          // Owner should update CATALOGUE_FORM_ID in catalogues.ts; pilot form is n0vqEP
          if (formId === 'n0vqEP') {
            track('pilot_form_submitted', { formId });
          } else {
            track('catalogue_form_submitted', { formId });
          }
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [track]);

  // Returns a ref callback that fires catalogue_section_viewed once when the element enters the viewport
  const sectionRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            track('catalogue_section_viewed');
            observer.disconnect();
          }
        },
        { threshold: 0.3 }
      );
      observer.observe(node);
    },
    [track]
  );

  return { track, sectionRef, getEvents: () => events.current };
}
