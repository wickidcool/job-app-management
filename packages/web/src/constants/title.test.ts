import { describe, expect, it } from 'vitest';

import {
  formatTitle,
  HOOK_TITLED_ROUTES,
  LOGIN_TITLE,
  PRODUCT_NAME,
  REDIRECT_ROUTES,
  STATIC_ROUTE_TITLES,
  TITLE_SEPARATOR,
} from './title';
import { NOT_FOUND_COPY } from '../pages/NotFound.copy';

describe('formatTitle', () => {
  it('suffixes the product name', () => {
    expect(formatTitle('Dashboard')).toBe('Dashboard — Careerpin');
  });

  it('uses an em dash (U+2014), not a hyphen', () => {
    // Worth pinning rather than assuming: an assertion hand-typed with `-` passes review
    // and fails at run time, and Playwright's toHaveTitle(string) is an exact match.
    expect(TITLE_SEPARATOR).toBe(' — ');
    expect(formatTitle('Reports')).not.toContain(' - ');
  });

  it('returns the bare product name when there is no page name', () => {
    // The `index.html` case: a title for the moment before React mounts. `Careerpin`,
    // never `undefined — Careerpin` or a dangling separator.
    expect(formatTitle()).toBe(PRODUCT_NAME);
    expect(formatTitle(undefined)).toBe(PRODUCT_NAME);
    expect(formatTitle('')).toBe(PRODUCT_NAME);
    expect(formatTitle('   ')).toBe(PRODUCT_NAME);
  });

  it('trims, so a padded heading cannot produce a double space at the seam', () => {
    expect(formatTitle('  Settings  ')).toBe('Settings — Careerpin');
  });
});

describe('the product name lives in exactly one place (AC2)', () => {
  it('is what the public site and the production host call this product', () => {
    expect(PRODUCT_NAME).toBe('Careerpin');
  });

  it('keeps the stale product name out of every title', () => {
    // Scoped to titles on purpose, and the scope is the honest claim: `Job Application
    // Manager` is gone from `index.html` and from Login's <h2>, the two places §2 named —
    // but it survives as prose in OnboardingModal.tsx:330 and QuickReferenceExport.tsx:201,
    // which are the Copywriter's to rename and are recorded in the spec's §9. Asserting
    // "gone everywhere" here would be a test that documents a falsehood.
    const titles = Object.values(STATIC_ROUTE_TITLES).concat(LOGIN_TITLE);
    for (const title of titles) {
      expect(title).not.toContain('Job Application Manager');
      // A route's title is the page name alone — the suffix is formatTitle's job. A row
      // that spells the product name itself would double it: "Reports — Careerpin — Careerpin".
      expect(title).not.toContain(PRODUCT_NAME);
      expect(title).not.toContain(TITLE_SEPARATOR);
    }
  });
});

describe('the 404 title is read from the page copy, never retyped (AC5)', () => {
  it('is the catch-all route entry verbatim', () => {
    expect(STATIC_ROUTE_TITLES['*']).toBe(NOT_FOUND_COPY.heading);
  });

  it('uses the straight apostrophe the heading actually ships, not the typographic one', () => {
    // The trap ROUTE_TITLE_CONVENTION.md §7 calls out by name: the separator is
    // typographic (U+2014) and the apostrophe is not (U+0027). Retyping the heading from
    // the design doc — whose prose uses U+2019 — silently produces a title that no longer
    // matches the <h1>, which is the one thing this convention exists to guarantee.
    expect(STATIC_ROUTE_TITLES['*']).toContain('\u0027'); // straight apostrophe
    expect(STATIC_ROUTE_TITLES['*']).not.toContain('\u2019'); // typographic apostrophe
  });
});

describe('route groups are disjoint', () => {
  it('assigns each route to exactly one titling strategy', () => {
    // A path in two groups would be titled twice — once by the shell and once by the
    // page — and which won would depend on effect ordering.
    const all = [...Object.keys(STATIC_ROUTE_TITLES), ...HOOK_TITLED_ROUTES, ...REDIRECT_ROUTES];
    expect(all.length).toBe(new Set(all).size);
  });

  it('gives every statically-titled route a non-empty title', () => {
    for (const [path, title] of Object.entries(STATIC_ROUTE_TITLES)) {
      expect(title.trim(), `${path} has a blank title`).not.toBe('');
    }
  });
});
