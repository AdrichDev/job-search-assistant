import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteNav } from '@/components/site-nav';
import { ViewIn } from '@/components/view-in';
import { ES } from '@/copy/es';
import './globals.css';

export const metadata: Metadata = {
  title: ES.meta.title,
  description: ES.meta.description,
};

/**
 * `lang="es"` is not decoration: it tells a screen reader which pronunciation
 * rules to use and lets the browser hyphenate correctly. A Spanish interface
 * declared as English is read aloud as gibberish.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen font-sans">
        {/*
          The header sits in the LAYOUT, not in each page: that is what makes the
          navigation dynamic -it never remounts, and only the content below it
          changes. The top padding reserves its height.
        */}
        <SiteNav />
        <div className="pt-16">
          <ViewIn>{children}</ViewIn>
        </div>
      </body>
    </html>
  );
}
