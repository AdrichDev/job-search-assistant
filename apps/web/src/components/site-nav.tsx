'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ES } from '@/copy/es';

const TRACKING_PATH = '/seguimiento';
const ANALYSIS_PATH = '/analisis';
const MODELS_PATH = '/modelos';

type Section = 'offers' | 'analysis' | 'tracking' | 'models';

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Skip link plus the four-view navigation, rendered on every page by the layout.
 *
 * Client component only for `usePathname`, so `aria-current="page"` is correct
 * on every route without each page passing itself in. The skip link lives here
 * (still the first focusable element) because its target differs per page: the
 * offer list on `/`, the results on `/analisis`, the table on `/seguimiento`,
 * the models on `/modelos`.
 */
export function SiteNav() {
  const pathname = usePathname();
  const section: Section = isUnder(pathname, TRACKING_PATH)
    ? 'tracking'
    : isUnder(pathname, ANALYSIS_PATH)
      ? 'analysis'
      : isUnder(pathname, MODELS_PATH)
        ? 'models'
        : 'offers';

  /*
   * Back to the original selection style, as the user asked: the current section
   * is a solid WHITE pill with dark text. The white and the dark both come from
   * the theme mirror (`bg-slate-900` paints the light surface, `text-white` the
   * dark foreground), which is why the class names read backwards.
   */
  const link =
    'rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white';
  const current = (which: Section) => (section === which ? { 'aria-current': 'page' as const } : {});

  const skip = {
    offers: { href: '#queue', text: ES.skipToContent },
    analysis: { href: '#analisis', text: ES.analysis.skipToContent },
    tracking: { href: '#seguimiento', text: ES.tracking.skipToContent },
    models: { href: '#modelos', text: ES.models.skipToContent },
  }[section];

  return (
    <>
      <a
        href={skip.href}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
      >
        {skip.text}
      </a>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white">
        <nav
          aria-label={ES.tracking.nav.label}
          className="mx-auto grid h-14 w-full max-w-[1800px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6 lg:px-8"
        >
          {/* Centred, as asked; the empty halves keep it exactly in the middle. */}
          <span aria-hidden="true" />
          <ul className="col-start-2 flex items-center gap-1">
            <li>
              <Link href="/" className={link} {...current('offers')}>
                {ES.tracking.nav.offers}
              </Link>
            </li>
            <li>
              <Link href={ANALYSIS_PATH} className={link} {...current('analysis')}>
                {ES.tracking.nav.analysis}
              </Link>
            </li>
            <li>
              <Link href={TRACKING_PATH} className={link} {...current('tracking')}>
                {ES.tracking.nav.tracking}
              </Link>
            </li>
            <li>
              <Link href={MODELS_PATH} className={link} {...current('models')}>
                {ES.tracking.nav.models}
              </Link>
            </li>
          </ul>
          <span aria-hidden="true" />
        </nav>
      </header>
    </>
  );
}
