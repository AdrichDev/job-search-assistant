'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ES } from '@/copy/es';

const TRACKING_PATH = '/seguimiento';

/**
 * Skip link plus the two-view navigation, rendered on every page by the layout.
 *
 * Client component only for `usePathname`, so `aria-current="page"` is correct
 * on every route without each page passing itself in. The skip link lives here
 * (still the first focusable element) because its target differs per page: the
 * offer list on `/`, the table on `/seguimiento`.
 */
export function SiteNav() {
  const pathname = usePathname();
  const onTracking = pathname === TRACKING_PATH || pathname.startsWith(`${TRACKING_PATH}/`);

  const link =
    'rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white';

  return (
    <>
      <a
        href={onTracking ? '#seguimiento' : '#queue'}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        {onTracking ? ES.tracking.skipToContent : ES.skipToContent}
      </a>
      <nav aria-label={ES.tracking.nav.label} className="border-b border-slate-200 bg-white">
        <ul className="mx-auto flex max-w-7xl gap-1 px-4 py-2 sm:px-6">
          <li>
            <Link href="/" className={link} {...(onTracking ? {} : { 'aria-current': 'page' as const })}>
              {ES.tracking.nav.offers}
            </Link>
          </li>
          <li>
            <Link
              href={TRACKING_PATH}
              className={link}
              {...(onTracking ? { 'aria-current': 'page' as const } : {})}
            >
              {ES.tracking.nav.tracking}
            </Link>
          </li>
        </ul>
      </nav>
    </>
  );
}
