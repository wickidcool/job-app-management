import { describe, it, expect } from 'vitest';
import { targetsApplication, itemsForApplication } from './applicationMatch';
import type { CoverLetterSummary, ResumeVariantSummary } from '../services/api/types';

function letter(overrides: Partial<CoverLetterSummary> = {}): CoverLetterSummary {
  return {
    id: 'cl_1',
    status: 'draft',
    title: 'Cover Letter - Staff Engineer at Acme',
    targetCompany: 'Acme',
    targetRole: 'Staff Engineer',
    tone: 'professional',
    lengthVariant: 'standard',
    preview: 'Dear hiring manager…',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function variant(overrides: Partial<ResumeVariantSummary> = {}): ResumeVariantSummary {
  return {
    id: 'rv_1',
    status: 'draft',
    title: 'Resume - Staff Engineer at Acme',
    targetCompany: 'Acme',
    targetRole: 'Staff Engineer',
    format: 'chronological',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const application = { company: 'Acme', jobTitle: 'Staff Engineer' };

describe('targetsApplication', () => {
  it('matches when company and role both agree', () => {
    expect(targetsApplication(letter(), application)).toBe(true);
  });

  it('ignores case and surrounding whitespace on both fields', () => {
    expect(
      targetsApplication(
        letter({ targetCompany: '  ACME ', targetRole: 'staff engineer' }),
        application
      )
    ).toBe(true);
  });

  it('rejects a letter for a different role at the same company', () => {
    expect(targetsApplication(letter({ targetRole: 'Engineering Manager' }), application)).toBe(
      false
    );
  });

  it('rejects a letter for a different company in the same role', () => {
    expect(targetsApplication(letter({ targetCompany: 'Globex' }), application)).toBe(false);
  });

  /**
   * The reason this predicate exists rather than leaning on the endpoints' own
   * `?company=` filter, which is `ilike '%company%'` — a substring match. The
   * server will hand back the Metabase artefact when asked for "Meta"; the
   * client must not then show it on a Meta application.
   *
   * This is the discriminating case: delete the `targetCompany` comparison and
   * only this test and the "different company" one above go red.
   */
  it('rejects a company that merely contains the application company as a substring', () => {
    expect(
      targetsApplication(letter({ targetCompany: 'Metabase' }), {
        company: 'Meta',
        jobTitle: 'Staff Engineer',
      })
    ).toBe(false);
  });

  /**
   * The known precision ceiling, pinned so it is a documented property rather
   * than a surprise. Two applications for the same role at the same company are
   * indistinguishable without a persisted `applicationId` (WIC-1544). If this
   * ever starts failing, the association became real and `applicationMatch.ts`
   * should be deleted in favour of it.
   */
  it('cannot separate two applications for the same role at the same company', () => {
    const first = { company: 'Acme', jobTitle: 'Staff Engineer' };
    const second = { company: 'Acme', jobTitle: 'Staff Engineer' };
    expect(targetsApplication(letter(), first)).toBe(true);
    expect(targetsApplication(letter(), second)).toBe(true);
  });

  /**
   * The generalisation WIC-1536 needed, exercised rather than asserted.
   *
   * The predicate was written for cover letters (WIC-1533) and is now the sole
   * matcher for resume variants too. `ResumeVariantSummary` is a *different*
   * hand-written interface in the same file as `CoverLetterSummary` — the two
   * are not related by inheritance — so "it is generic" is a claim about a
   * second concrete type, and only feeding that type through proves it.
   */
  it('places a resume variant by the same rule as a cover letter', () => {
    expect(targetsApplication(variant(), application)).toBe(true);
    expect(targetsApplication(variant({ targetRole: 'Engineering Manager' }), application)).toBe(
      false
    );
    expect(
      targetsApplication(variant({ targetCompany: 'Metabase' }), {
        company: 'Meta',
        jobTitle: 'Staff Engineer',
      })
    ).toBe(false);
  });
});

describe('itemsForApplication', () => {
  it('keeps only the matching letters', () => {
    const letters = [
      letter({ id: 'match' }),
      letter({ id: 'other-company', targetCompany: 'Globex' }),
      letter({ id: 'other-role', targetRole: 'Engineering Manager' }),
    ];

    expect(itemsForApplication(letters, application).map((l) => l.id)).toEqual(['match']);
  });

  it('returns newest first regardless of the order it received them in', () => {
    const letters = [
      letter({ id: 'oldest', createdAt: '2026-08-01T00:00:00.000Z' }),
      letter({ id: 'newest', createdAt: '2026-08-20T00:00:00.000Z' }),
      letter({ id: 'middle', createdAt: '2026-08-10T00:00:00.000Z' }),
    ];

    expect(itemsForApplication(letters, application).map((l) => l.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('returns an empty list rather than throwing when nothing matches', () => {
    expect(itemsForApplication([letter({ targetCompany: 'Globex' })], application)).toEqual([]);
  });

  /**
   * Filters and orders resume variants identically — and, in the assignment on
   * the first line, pins that the return type is still `ResumeVariantSummary[]`
   * and not a widened `TargetedItem[]`.
   *
   * That assignment is the part worth having. A non-generic signature returning
   * `TargetedItem[]` would pass every runtime assertion in this block and then
   * fail at the call site, where `ApplicationDetail` reads `.id` off the newest
   * variant to build the checklist link.
   */
  it('filters and orders resume variants, keeping the concrete summary type', () => {
    const variants: ResumeVariantSummary[] = itemsForApplication(
      [
        variant({ id: 'older', createdAt: '2026-08-01T00:00:00.000Z' }),
        variant({ id: 'other-company', targetCompany: 'Globex' }),
        variant({ id: 'newer', createdAt: '2026-08-20T00:00:00.000Z' }),
      ],
      application
    );

    expect(variants.map((v) => v.id)).toEqual(['newer', 'older']);
    expect(variants[0]?.format).toBe('chronological');
  });
});

/**
 * Guards on the web summary types, not on the functions above.
 *
 * `CoverLetterSummary` and `ResumeVariantSummary` are hand-written to mirror
 * the API's DTOs; they are separate interfaces in separate packages, so `tsc`
 * cannot compare them and drift is silent. `CoverLetterSummary` had already
 * drifted — it declared a `keywords: string[]` the API has never sent and
 * omitted `targetCompany`/`targetRole`, which is why the association looked
 * impossible to reconstruct (WIC-1533).
 *
 * These pin the fields this feature depends on. If someone removes them again,
 * this fails to compile rather than silently un-matching every artefact at
 * runtime.
 */
describe('summary type contracts', () => {
  it('CoverLetterSummary carries the target company and role the API sends', () => {
    const company: string = letter().targetCompany;
    const role: string = letter().targetRole;
    const status: 'draft' | 'finalized' = letter().status;

    expect({ company, role, status }).toEqual({
      company: 'Acme',
      role: 'Staff Engineer',
      status: 'draft',
    });
  });

  it('ResumeVariantSummary carries the same pair', () => {
    const company: string = variant().targetCompany;
    const role: string = variant().targetRole;
    const id: string = variant().id;

    expect({ company, role, id }).toEqual({
      company: 'Acme',
      role: 'Staff Engineer',
      id: 'rv_1',
    });
  });
});
