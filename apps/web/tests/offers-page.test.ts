import { describe, expect, it } from 'vitest';
import { OFFERS_PAGE_SIZE, paginateOffers } from '@/lib/offers-page';

function rows(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

describe('paginateOffers', () => {
  it('uses ten per page, the same size as the tracking table', () => {
    expect(OFFERS_PAGE_SIZE).toBe(10);
  });

  it('splits into pages and reports the range it is showing', () => {
    const page = paginateOffers(rows(25), 2);
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(3);
    expect(page.rows).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page.from).toBe(11);
    expect(page.to).toBe(20);
    expect(page.total).toBe(25);
  });

  it('clamps a page past the end instead of showing nothing', () => {
    const page = paginateOffers(rows(12), 99);
    expect(page.page).toBe(2);
    expect(page.rows).toEqual([11, 12]);
  });

  it('treats page zero or a negative page as the first one', () => {
    for (const bad of [0, -3, Number.NaN]) {
      const page = paginateOffers(rows(12), bad);
      expect(page.page).toBe(1);
      expect(page.rows[0]).toBe(1);
    }
  });

  it('reports one page and an empty range for an empty list', () => {
    const page = paginateOffers([], 1);
    expect(page.totalPages).toBe(1);
    expect(page.rows).toEqual([]);
    expect(page.from).toBe(0);
    expect(page.to).toBe(0);
    expect(page.total).toBe(0);
  });
});
