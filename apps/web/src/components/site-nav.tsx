'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ES } from '@/copy/es';

const TRACKING_PATH = '/seguimiento';
const MODELS_PATH = '/modelos';

type Section = 'offers' | 'tracking' | 'models';

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Skip link plus the three-view navigation, rendered on every page by the layout.
 *
 * Client component only for `usePathname`, so `aria-current="page"` is correct
 * on every route without each page passing itself in. The skip link lives here
 * (still the first focusable element) because its target differs per page: the
 * offer list on `/`, the table on `/seguimiento`, the models on `/modelos`.
 */
export function SiteNav() {
  const pathname = usePathname();
  const section: Section = isUnder(pathname, TRACKING_PATH)
    ? 'tracking'
    : isUnder(pathname, MODELS_PATH)
      ? 'models'
      : 'offers';

  /*
   * Each section owns a hue, and only the current one is lit. That is the whole
   * differentiation budget of the nav: colour says WHERE you are, so the eye
   * finds it without reading, and nothing competes with the Apply button.
   */
  /*
   * The reference the user pointed at: a FIXED, centred navigation over the
   * content, glassy, with the current section marked in white and a gradient
   * underline. Colour marks identity; it never competes with the primary action.
   */
  const link =
    'relative rounded-full px-4 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-white aria-[current=page]:text-white';
  const current = (which: Section) => (section === which ? { 'aria-current': 'page' as const } : {});

  const skip = {
    offers: { href: '#queue', text: ES.skipToContent },
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
      <header className="glass-strong fixed inset-x-0 top-0 z-50">
        <nav
          aria-label={ES.tracking.nav.label}
          className="mx-auto grid h-16 w-full max-w-[1800px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 sm:px-6 lg:px-8"
        >
          {/* Brand: the gradient is the only place it appears at rest. */}
          <Link href="/" className="flex items-center gap-2 justify-self-start">
            <span className="btn-grad grid h-8 w-8 place-items-center rounded-lg text-sm font-black">
              J
            </span>
            <span className="hidden text-sm font-semibold tracking-tight text-white sm:block">
              {ES.nav.brand}
            </span>
          </Link>

          <ul className="col-start-2 flex items-center gap-1">
            <li>
              <Link href="/" className={`${link} after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-[image:var(--grad)] after:content-[''] after:opacity-0 aria-[current=page]:after:opacity-100`} {...current('offers')}>
                {ES.tracking.nav.offers}
              </Link>
            </li>
            <li>
              <Link href={TRACKING_PATH} className={`${link} after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-[image:var(--grad)] after:content-[''] after:opacity-0 aria-[current=page]:after:opacity-100`} {...current('tracking')}>
                {ES.tracking.nav.tracking}
              </Link>
            </li>
            <li>
              <Link href={MODELS_PATH} className={`${link} after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-[image:var(--grad)] after:content-[''] after:opacity-0 aria-[current=page]:after:opacity-100`} {...current('models')}>
                {ES.tracking.nav.models}
              </Link>
            </li>
          </ul>

          <span aria-hidden="true" className="justify-self-end text-xs font-medium text-slate-500">
            {ES.nav.tagline}
          </span>
        </nav>
      </header>
    </>
  );
}
