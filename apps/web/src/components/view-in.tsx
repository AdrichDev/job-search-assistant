'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The sliding main.
 *
 * The header lives in the layout, so it never re-renders; this wrapper keys the
 * content on the pathname, which is what makes switching sections read as a
 * slide from the right instead of a page reload. `prefers-reduced-motion` is
 * handled globally in globals.css, so the animation collapses to nothing for
 * anyone who asked for that.
 */
export function ViewIn({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  /*
   * The animation belongs to NAVIGATION, not to the first paint: animating the
   * initial load makes the page feel slower than it is, and -measured in the
   * no-JavaScript spec- it also leaves the element "unstable" for Playwright
   * because the slide starts as soon as the document is ready. So the class is
   * added after hydration, and only then does a route change slide.
   */
  const hydrated = useRef(false);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (hydrated.current) {
      return;
    }
    hydrated.current = true;
    setAnimate(true);
  }, []);

  return (
    <div key={pathname} className={animate ? 'view-in' : undefined}>
      {children}
    </div>
  );
}
