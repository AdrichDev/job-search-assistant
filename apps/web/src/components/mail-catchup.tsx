'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { catchUpMailAction } from '@/app/mail-actions';

/**
 * Fires the on-open mail catch-up once (the ref survives StrictMode's double
 * mount) and refreshes only when a run happened. Renders nothing; no timers.
 */
export function MailCatchUp({ due }: { readonly due: boolean }): null {
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    if (!due || started.current) {
      return;
    }
    started.current = true;
    catchUpMailAction()
      .then(({ ran }) => {
        if (ran) {
          router.refresh();
        }
      })
      .catch(() => undefined);
  }, [due, router]);

  return null;
}
