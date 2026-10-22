import type { Page } from '@playwright/test';

/**
 * WCAG 2.1 contrast, measured in the browser on the real rendered colours.
 *
 * The dark theme mirrors Tailwind's light palette (apps/web/tailwind.config.ts),
 * so reading a class name tells you nothing about what the user sees. This walks
 * the composited colours instead: the element's own `color` against the first
 * ancestor whose `background-color` is (nearly) opaque.
 *
 * Known limits, stated instead of hidden: gradients and background images are
 * treated as the nearest opaque colour behind them, so a text sitting on a
 * gradient is measured against the page, not the gradient. Nothing here checks
 * images.
 */

export interface ContrastSample {
  readonly label: string;
  readonly text: string;
  readonly ratio: number;
  readonly required: number;
  readonly color: string;
  readonly background: string;
  readonly fontSize: number;
  readonly bold: boolean;
}

/** Runs in the page: measures the given selectors and returns their contrast. */
export async function measureContrast(page: Page, selectors: readonly string[]): Promise<readonly ContrastSample[]> {
  return page.evaluate((list) => {
    interface Rgba {
      r: number;
      g: number;
      b: number;
      a: number;
    }

    const parse = (value: string): Rgba | null => {
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (match === null) {
        return null;
      }
      const raw = match[1];
      if (raw === undefined) {
        return null;
      }
      const parts = raw.split(',').map((part) => Number.parseFloat(part.trim()));
      const [r, g, b, alpha] = parts;
      if (r === undefined || g === undefined || b === undefined) {
        return null;
      }
      if ([r, g, b].some((part) => Number.isNaN(part))) {
        return null;
      }
      return { r, g, b, a: alpha === undefined || Number.isNaN(alpha) ? 1 : alpha };
    };

    const channel = (value: number): number => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };

    const luminance = ({ r, g, b }: Rgba): number =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

    const ratioOf = (front: Rgba, back: Rgba): number => {
      const a = luminance(front);
      const b = luminance(back);
      const lighter = Math.max(a, b);
      const darker = Math.min(a, b);
      return (lighter + 0.05) / (darker + 0.05);
    };

    const backgroundBehind = (element: Element): Rgba => {
      let current: Element | null = element;
      while (current !== null) {
        const colour = parse(getComputedStyle(current).backgroundColor);
        if (colour !== null && colour.a >= 0.9) {
          return colour;
        }
        current = current.parentElement;
      }
      // The page canvas: white unless something above it said otherwise.
      return { r: 255, g: 255, b: 255, a: 1 };
    };

    const samples: ContrastSample[] = [];
    for (const selector of list) {
      for (const element of Array.from(document.querySelectorAll(selector)).slice(0, 12)) {
        const style = getComputedStyle(element);
        const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const front = parse(style.color);
        if (front === null || text.length === 0 || style.visibility === 'hidden') {
          continue;
        }
        if (element.getBoundingClientRect().height === 0) {
          continue;
        }
        const back = backgroundBehind(element);
        const fontSize = Number.parseFloat(style.fontSize);
        const weight = Number.parseInt(style.fontWeight, 10);
        const bold = !Number.isNaN(weight) && weight >= 700;
        const large = fontSize >= 24 || (bold && fontSize >= 18.66);
        samples.push({
          label: selector,
          text,
          ratio: Math.round(ratioOf(front, back) * 100) / 100,
          // WCAG AA: 4.5:1 for normal text, 3:1 for large text.
          required: large ? 3 : 4.5,
          color: style.color,
          background: `rgb(${back.r}, ${back.g}, ${back.b})`,
          fontSize,
          bold,
        });
      }
    }
    return samples;
  }, selectors);
}
