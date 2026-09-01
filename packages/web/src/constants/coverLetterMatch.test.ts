import { describe, it, expect } from 'vitest';
import { coverLetterMatchesApplication, coverLettersForApplication } from './coverLetterMatch';
import type { CoverLetterSummary } from '../services/api/types';

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

const application = { company: 'Acme', jobTitle: 'Staff Engineer' };

describe('coverLetterMatchesApplication', () => {
  it('matches when company and role both agree', () => {
    expect(coverLetterMatchesApplication(letter(), application)).toBe(true);
  });

  it('ignores case and surrounding whitespace on both fields', () => {
    expect(
      coverLetterMatchesApplication(
        letter({ targetCompany: '  ACME ', targetRole: 'staff engineer' }),
        application
      )
    ).toBe(true);
  });

  it('rejects a letter for a different role at the same company', () => {
    expect(
      coverLetterMatchesApplication(letter({ targetRole: 'Engineering Manager' }), application)
    ).toBe(false);
  });

  it('rejects a letter for a different company in the same role', () => {
    expect(coverLetterMatchesApplication(letter({ targetCompany: 'Globex' }), application)).toBe(
      false
    );
  });

  /**
   * The reason this predicate exists rather than leaning on the endpoint's own
   * `?company=` filter, which is `ilike '%company%'` — a substring match. The
   * server will hand back the Metabase letter when asked for "Meta"; the
   * client must not then show it on a Meta application.
   *
   * This is the discriminating case: delete the `targetCompany` comparison and
   * only this test and the "different company" one above go red.
   */
  it('rejects a company that merely contains the application company as a substring', () => {
    expect(
      coverLetterMatchesApplication(letter({ targetCompany: 'Metabase' }), {
        company: 'Meta',
        jobTitle: 'Staff Engineer',
      })
    ).toBe(false);
  });

  /**
   * The known precision ceiling, pinned so it is a documented property rather
   * than a surprise. Two applications for the same role at the same company are
   * indistinguishable without a persisted `applicationId` (WIC-1544). If this
   * ever starts failing, the association became real and `coverLetterMatch.ts`
   * should be deleted in favour of it.
   */
  it('cannot separate two applications for the same role at the same company', () => {
    const first = { company: 'Acme', jobTitle: 'Staff Engineer' };
    const second = { company: 'Acme', jobTitle: 'Staff Engineer' };
    expect(coverLetterMatchesApplication(letter(), first)).toBe(true);
    expect(coverLetterMatchesApplication(letter(), second)).toBe(true);
  });
});

describe('coverLettersForApplication', () => {
  it('keeps only the matching letters', () => {
    const letters = [
      letter({ id: 'match' }),
      letter({ id: 'other-company', targetCompany: 'Globex' }),
      letter({ id: 'other-role', targetRole: 'Engineering Manager' }),
    ];

    expect(coverLettersForApplication(letters, application).map((l) => l.id)).toEqual(['match']);
  });

  it('returns newest first regardless of the order it received them in', () => {
    const letters = [
      letter({ id: 'oldest', createdAt: '2026-08-01T00:00:00.000Z' }),
      letter({ id: 'newest', createdAt: '2026-08-20T00:00:00.000Z' }),
      letter({ id: 'middle', createdAt: '2026-08-10T00:00:00.000Z' }),
    ];

    expect(coverLettersForApplication(letters, application).map((l) => l.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
  });

  it('returns an empty list rather than throwing when nothing matches', () => {
    expect(coverLettersForApplication([letter({ targetCompany: 'Globex' })], application)).toEqual(
      []
    );
  });
});

/**
 * A guard on the web `CoverLetterSummary` type, not on the functions above.
 *
 * `CoverLetterSummary` is hand-written to mirror the API's
 * `CoverLetterSummaryDTO`; they are separate interfaces in separate packages,
 * so `tsc` cannot compare them and drift is silent. It had already drifted —
 * the web type declared a `keywords: string[]` the API has never sent and
 * omitted `targetCompany`/`targetRole`, which is why the association below
 * looked impossible to reconstruct (WIC-1533).
 *
 * This pins the two fields this feature depends on. If someone removes them
 * from the web type again, this fails to compile rather than silently
 * un-matching every letter at runtime.
 */
describe('CoverLetterSummary contract', () => {
  it('carries the target company and role the API sends', () => {
    const company: string = letter().targetCompany;
    const role: string = letter().targetRole;
    const status: 'draft' | 'finalized' = letter().status;

    expect({ company, role, status }).toEqual({
      company: 'Acme',
      role: 'Staff Engineer',
      status: 'draft',
    });
  });
});
