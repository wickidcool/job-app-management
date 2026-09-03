// WIC-1492 / WIC-1808 — `reviseCoverLetter` persisted an unvalidated STAR id list.
//
// `generateCoverLetter` computes `invalidIds` against the rows the catalog read
// actually returned and throws `STAR_ENTRY_NOT_FOUND` (404). `reviseCoverLetter`
// had no equivalent check: it fetched with `fetchStarEntries(selectedIds)` and
// then wrote the *raw* caller list into `selectedStarEntryIds`, so an id that
// resolved to nothing was still persisted onto the row.
//
// The assertions here are on `stub.updates` — what the UPDATE was handed — not on
// the returned DTO. That distinction is the point of the file. The service builds
// its response from the row the UPDATE returns, so a fix that merely sanitised the
// DTO would leave the bad id in the database and still satisfy a response-shaped
// test. `selectedStarEntryIds` is exactly the column WIC-1492 is about.
//
// Scope note, deliberate. On `main` `fetchStarEntries` carries no owner term, so
// "did not resolve" here means "does not exist". PR #159 (WIC-1437) adds the owner
// term, at which point another user's id also stops resolving and this same guard
// starts rejecting it with no further change — that composition is why the check
// is written against the *fetched rows* rather than against an existence query of
// its own. A foreign-id case is not asserted here because it would be green for
// the wrong reason until #159 lands.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/config.js', () => ({
  getConfig: vi.fn(() => ({ anthropicApiKey: 'sk-test' })),
}));

const anthropicCtor = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages: unknown;
    constructor(opts: unknown) {
      this.messages = anthropicCtor(opts);
    }
  },
}));

import { getDb } from '../src/db/client.js';
import { coverLetters } from '../src/db/schema.js';
import { reviseCoverLetter } from '../src/services/cover-letter.service.js';
import { CoverLetterError } from '../src/types/index.js';
import { stubDb, stubAnthropic, type CatalogRow } from './helpers/star-catalog-stub.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';

const LETTER_ID = '01HZ_CL_0001';
const REAL_BULLET = '01HZ_BUL_REAL';
const GONE_BULLET = '01HZ_BUL_GONE';

function bulletRow(overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id: REAL_BULLET,
    rawText: 'Shipped the billing rewrite at Acme Corp, cutting invoice errors 41%.',
    impactCategory: 'delivery',
    sourceId: '01HZ_RES_0001',
    userId: CALLER,
    ...overrides,
  };
}

function letterRow(storedIds: string[]) {
  const now = new Date('2026-08-30T00:00:00.000Z');
  return {
    id: LETTER_ID,
    userId: CALLER,
    status: 'draft',
    title: 'Staff Engineer — Acme',
    targetCompany: 'Acme Corp',
    targetRole: 'Staff Engineer',
    tone: 'professional',
    lengthVariant: 'standard',
    emphasis: 'balanced',
    jobDescriptionText: 'Staff engineer, platform.',
    jobDescriptionUrl: null,
    jobFitAnalysisId: null,
    selectedStarEntryIds: storedIds,
    content: 'Dear Hiring Manager, ...',
    revisionHistory: [],
    createdAt: now,
    updatedAt: now,
    version: 3,
  };
}

/**
 * `catalog` is the whole `quantified_bullets` fixture; the read filters it by its
 * own rendered predicate, so an id absent from here is an id that does not resolve.
 */
function stub(storedIds: string[], catalog: CatalogRow[]) {
  const ai = stubAnthropic(() => 'Dear Hiring Manager, the revised letter.');
  anthropicCtor.mockReturnValue(ai.client.messages);
  const s = stubDb({ catalog, tables: [[coverLetters, [letterRow(storedIds)]]] });
  vi.mocked(getDb).mockReturnValue(s.db as ReturnType<typeof getDb>);
  return { ...s, ai };
}

/** What the UPDATE was told to write into `selected_star_entry_ids`. */
function persistedIds(updates: Array<{ values: unknown }>): unknown {
  return (updates[0]?.values as { selectedStarEntryIds?: unknown })?.selectedStarEntryIds;
}

const REVISE = { instructions: 'Tighten the opening paragraph.', version: 3 };

describe('reviseCoverLetter STAR id validation (WIC-1492)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a caller-supplied id that does not resolve, and writes nothing', async () => {
    const s = stub([REAL_BULLET], [bulletRow()]);

    const err = await reviseCoverLetter(
      LETTER_ID,
      { ...REVISE, selectedStarEntryIds: [REAL_BULLET, GONE_BULLET] },
      CALLER
    ).catch((e: unknown) => e);

    // Asserted as a caught value rather than with `rejects`, so a *resolved*
    // promise fails here on the instanceof rather than passing silently.
    expect(err, 'the unresolvable id is refused').toBeInstanceOf(CoverLetterError);
    expect((err as CoverLetterError).code).toBe('STAR_ENTRY_NOT_FOUND');
    expect((err as CoverLetterError).statusCode).toBe(404);
    expect(
      ((err as CoverLetterError).details as { invalidIds: string[] }).invalidIds,
      'only the unresolvable id is named — the valid one is not collateral'
    ).toEqual([GONE_BULLET]);

    // The defect was a persisted value, so absence of the write is the assertion
    // that matters. Pre-fix this array held one update carrying both ids.
    expect(s.updates, 'no UPDATE is issued on the reject path').toHaveLength(0);
    expect(s.ai.prompts, 'and no model call is paid for either').toHaveLength(0);
  });

  it('persists a caller-supplied list once every id resolves', async () => {
    const second = bulletRow({ id: '01HZ_BUL_TWO', rawText: 'Cut p99 checkout latency 38%.' });
    const s = stub([REAL_BULLET], [bulletRow(), second]);

    await reviseCoverLetter(
      LETTER_ID,
      { ...REVISE, selectedStarEntryIds: [REAL_BULLET, second.id] },
      CALLER
    );

    expect(s.updates, 'the happy path still writes').toHaveLength(1);
    expect(persistedIds(s.updates), 'the caller list is stored verbatim').toEqual([
      REAL_BULLET,
      second.id,
    ]);
  });

  // The regression this fix is most likely to introduce, and the reason the guard
  // is scoped to `input.selectedStarEntryIds` instead of to `selectedIds`.
  //
  // `selectedIds` falls back to `existing.selectedStarEntryIds` when the caller
  // omits the field. Validating that fallback would 404 every instructions-only
  // revise of a row that already stores an unresolvable id — permanently, with no
  // way for the caller to clear it, since the request that would overwrite the bad
  // id is the same request being rejected. WIC-1492 filed this defect precisely
  // because the pre-fix write path keeps minting such rows, so that cohort is the
  // one the fix exists to serve, not one it may strand.
  it('does not reject an instructions-only revise of a row storing an unresolvable id', async () => {
    const s = stub([REAL_BULLET, GONE_BULLET], [bulletRow()]);

    await expect(
      reviseCoverLetter(LETTER_ID, REVISE, CALLER),
      'a legacy row stays revisable'
    ).resolves.toBeDefined();

    expect(s.updates).toHaveLength(1);
    expect(
      persistedIds(s.updates),
      'and its stored ids are preserved, not silently rewritten to the resolvable subset'
    ).toEqual([REAL_BULLET, GONE_BULLET]);
  });

  // An empty array is a real request — "drop every STAR entry from this letter" —
  // and `[] ?? existing` does not fall back, so it must not be confused with the
  // omitted case above. Distinguishes `if (input.selectedStarEntryIds)` (correct
  // here, `[]` is truthy) from an `if (…?.length)` guard, which would skip the
  // check and, more importantly, reads as if it were equivalent.
  it('accepts an explicit empty list and clears the stored ids', async () => {
    const s = stub([REAL_BULLET], [bulletRow()]);

    await reviseCoverLetter(LETTER_ID, { ...REVISE, selectedStarEntryIds: [] }, CALLER);

    expect(s.updates).toHaveLength(1);
    expect(persistedIds(s.updates), 'the clear is honoured').toEqual([]);
  });
});
