import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

/**
 * THIS APP IS DARK-ONLY, and the class NAMES no longer mean what they say.
 *
 * The components were written against Tailwind's default light palette
 * (`bg-white` card, `text-slate-900` text, `bg-amber-50` notice...). Instead of
 * rewriting ~300 class usages across 22 files, each scale the app uses is
 * MIRRORED here: shade 50 becomes the old 950, 100 becomes 900, and so on. Every
 * existing background/text pairing therefore keeps its contrast relationship,
 * just on a dark canvas:
 *
 *   bg-slate-50   -> the darkest slate, the page
 *   bg-white      -> a surface one step above the page (cards, nav, inputs)
 *   text-slate-900-> a near-white slate, the body text
 *   bg-amber-50 + text-amber-900 -> a dark amber notice with light amber text
 *
 * Why a remap and not CSS-variable tokens: there is exactly one theme, so
 * tokens would buy flexibility nobody asked for at the price of a 300-line
 * rename. If a light theme is ever wanted again, DELETE this remap and the
 * components are light again; or replace it with tokens at that point.
 *
 * Explicit values (arbitrary classes such as `bg-[#DCFCE7]`, used for the
 * spreadsheet-style state cells) are not part of any scale and bypass the remap
 * on purpose.
 *
 * The one exception is the middle of the slate scale, overridden below with an
 * explicit ramp because the mirror leaves it mid-grey and mid-grey text on a
 * near-black canvas fails WCAG AA.
 */

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;
type Shade = (typeof SHADES)[number];
type Scale = Record<Shade, string>;

function mirror(scale: Scale): Scale {
  const reversed = [...SHADES].reverse();
  return Object.fromEntries(SHADES.map((shade, index) => [shade, scale[reversed[index] as Shade]])) as Scale;
}

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // System stack: no webfont request, no layout shift, no extra dependency.
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        // A surface one step ABOVE the page (slate-50), so cards read as raised.
        white: '#111b30',
        /*
         * The mirror is exact for the extremes (50 is the page, 900 is body
         * text) but WRONG in the middle, because a mid grey is a mid grey: the
         * old slate-500 on a near-black canvas measures 3.61:1, under the 4.5
         * WCAG AA floor. The middle shades are used exclusively as TEXT in this
         * app (33 text-slate-500, 50 text-slate-600, 10 text-slate-400, and zero
         * backgrounds), so they get an explicit ascending ramp instead. The
         * e2e contrast spec (e2e/specs/contrast.spec.ts) holds every page to AA,
         * so this ramp is measured, not eyeballed.
         */
        slate: {
          ...mirror(colors.slate as unknown as Scale),
          '300': '#cbd5e1',
          '400': '#a8b6c8',
          '500': '#94a3b8',
          '600': '#7d8ca3',
        },
        amber: mirror(colors.amber as unknown as Scale),
        emerald: mirror(colors.emerald as unknown as Scale),
        indigo: mirror(colors.indigo as unknown as Scale),
        red: mirror(colors.red as unknown as Scale),
        sky: mirror(colors.sky as unknown as Scale),
      },
      // Default shadows are invisible on a dark canvas: stronger, with a hairline.
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.6), 0 0 0 1px rgb(148 163 184 / 0.06)',
        DEFAULT: '0 2px 6px -1px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(148 163 184 / 0.08)',
        md: '0 6px 16px -4px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(148 163 184 / 0.1)',
        lg: '0 12px 28px -6px rgb(0 0 0 / 0.75), 0 0 0 1px rgb(148 163 184 / 0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
