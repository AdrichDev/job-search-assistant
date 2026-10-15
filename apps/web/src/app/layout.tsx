import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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
        <a
          href="#queue"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          {ES.skipToContent}
        </a>
        {children}
      </body>
    </html>
  );
}
