// WIC-1520 — `relevanceScore` -> `relevanceScorePct` on the interview-prep
// population (ADR-008 §4).
//
// Why this file exists rather than an assertion bolted onto an existing one:
// when the rename was applied to `schema.ts` and `interviewPrep.service.ts`, the
// whole 753-test suite stayed **green with no test edits at all**. That is not a
// pass, it is a measurement that nothing observed the field. The one assertion
// that names it, `interview-prep.routes.test.ts:440`, sits behind
// `vi.mock('../src/services/interviewPrep.service.js')` and reads back the
// test's own `mockStory` fixture — so it asserts the route forwards an object,
// never that the service produced one. Renaming the fixture and the assertion
// together keeps it green in both directions. It is structurally incapable of
// failing on this change.
//
// So these tests drive the **real** service through the WIC-1449 stub harness.
// Each one is a gate on a specific site the acceptance criteria name:
//
//   - the LLM prompt's JSON key                 (service :324)
//   - the key read back off the model response  (service :557)
//   - the `[0, 100]` clamp                      (service :557)
//   - the DTO field on the wire                 (service :236, :82)
//   - the `/100` markdown export string         (service :1046)
//   - the column name, against the migration    (schema :708, migration 0020)
//
// ADR-008 §3 and WIC-1521 are explicit that the `Percent` brand does NOT cover
// any of these: it is checked on assignment only, and arithmetic, template
// interpolation and `JSON.stringify` all erase it. `relevanceScorePct: Percent`
// is typed *and* tested for exactly that reason.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildJournalEntries } from '../src/db/journal.js';

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
import { applications, interviewPreps, interviewPrepStories } from '../src/db/schema.js';
import {
  generateInterviewPrep,
  getInterviewPrep,
  exportInterviewPrep,
} from '../src/services/interviewPrep.service.js';
import { stubDb, stubAnthropic, type CatalogRow } from './helpers/star-catalog-stub.js';

const CALLER = '8f1d6b4a-0e2c-4a55-9b8e-3d7c1f2a5b60';
const APP_ID = '01HZ_APP_001';
const PREP_ID = '01HZ_PREP_001';
const BULLET_ID = '01HZ_BUL_MINE';

const CATALOG: CatalogRow[] = [
  {
    id: BULLET_ID,
    rawText: 'Shipped the billing rewrite at Acme Corp, cutting invoice errors 41%.',
    impactCategory: 'revenue',
    sourceId: '01HZ_RES_001',
    userId: CALLER,
  },
];

function appFixture() {
  return [
    [
      applications,
      [{ id: APP_ID, jobTitle: 'Staff Engineer', company: 'Acme Corp', status: 'applied' }],
    ],
  ] as Array<[unknown, Record<string, unknown>[]]>;
}

function install(stub: ReturnType<typeof stubDb>, ai: ReturnType<typeof stubAnthropic>) {
  vi.mocked(getDb).mockReturnValue(stub.db as ReturnType<typeof getDb>);
  anthropicCtor.mockReturnValue(ai.client.messages);
}

/**
 * A model reply carrying `score` under `key`. `key` is a parameter so the
 * negative controls below can send the **old** name and show the service no
 * longer reads it — without that direction, a test that only sends the new name
 * would pass just as happily against a service reading either one.
 */
function aiReturning(score: unknown, key = 'relevanceScorePct') {
  return stubAnthropic((prompt) => {
    const ids = [...prompt.matchAll(/\[ID:([^\]]+)\]/g)].map((m) => m[1]);
    return JSON.stringify({
      stories: ids.map((id) => ({
        starEntryId: id,
        themes: ['delivery'],
        [key]: score,
        oneMinVersion: `one ${id}`,
        twoMinVersion: `two ${id}`,
        fiveMinVersion: `five ${id}`,
      })),
      questions: [],
      gapMitigations: [],
      warnings: [],
    });
  });
}

/** Runs the real generate path and returns the row handed to the insert. */
async function persistedStory(score: unknown, key?: string) {
  const stub = stubDb({
    catalog: CATALOG,
    tables: [...appFixture(), [interviewPreps, []], [interviewPrepStories, []]],
  });
  const ai = aiReturning(score, key);
  install(stub, ai);

  await generateInterviewPrep({ applicationId: APP_ID }, CALLER);

  const write = stub.inserts.find((i) => i.table === interviewPrepStories);
  expect(write, 'no interview_prep_stories insert was issued').toBeDefined();
  const rows = write!.values as Array<Record<string, unknown>>;
  expect(rows).toHaveLength(1);
  return { row: rows[0], prompt: ai.prompts[0] };
}

/** A persisted `interview_prep_stories` row, in the column names the DTO reads. */
function storyRow(over: Record<string, unknown> = {}) {
  return {
    id: '01HZ_STORY_001',
    userId: CALLER,
    interviewPrepId: PREP_ID,
    starEntryId: BULLET_ID,
    themes: ['delivery'],
    relevanceScorePct: 92,
    oneMinVersion: 'one minute',
    twoMinVersion: 'two minutes',
    fiveMinVersion: 'five minutes',
    isFavorite: false,
    personalNotes: null,
    practiceCount: 0,
    lastPracticedAt: null,
    confidenceLevel: 'not_practiced',
    displayOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function prepRow() {
  return {
    id: PREP_ID,
    userId: CALLER,
    applicationId: APP_ID,
    jobFitAnalysisId: null,
    interviewType: 'behavioral',
    timeAvailable: '1_hour',
    focusAreas: [],
    generatedQuestions: [],
    gapMitigations: [],
    quickReference: null,
    practiceSessions: [],
    completeness: 50,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function readStub(stories: Array<Record<string, unknown>>) {
  const stub = stubDb({
    catalog: CATALOG,
    tables: [...appFixture(), [interviewPreps, [prepRow()]], [interviewPrepStories, stories]],
  });
  install(
    stub,
    stubAnthropic(() => '{}')
  );
  return stub;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WIC-1520 — the LLM boundary asks for, and reads, `relevanceScorePct`', () => {
  it('asks the model for `relevanceScorePct` and never for the bare name', async () => {
    const { prompt } = await persistedStory(92);

    expect(prompt).toContain('"relevanceScorePct": <0-100 integer>');
    // Anchored on the JSON key, not the substring: `relevanceScorePct` contains
    // `relevanceScore`, so a bare `.not.toContain('relevanceScore')` can never
    // pass and would make this assertion a permanent false alarm.
    expect(prompt, 'the prompt still asks for the pre-rename key').not.toContain(
      '"relevanceScore":'
    );
  });

  it('persists the value the model sent under the new key', async () => {
    const { row } = await persistedStory(92);
    expect(row.relevanceScorePct).toBe(92);
  });

  it('does NOT read the pre-rename key — a model still sending `relevanceScore` scores 0', async () => {
    // The negative control for the test above. Without it, a service reading
    // `s.relevanceScore` and one reading `s.relevanceScorePct` are
    // indistinguishable, because the fixture would supply both names.
    const { row } = await persistedStory(92, 'relevanceScore');
    expect(row.relevanceScorePct).toBe(0);
    expect(row.relevanceScorePct).not.toBe(92);
  });
});

describe('WIC-1520 — the `[0, 100]` clamp still bounds the write path', () => {
  // ADR-008 §3: `Percent` is checked on assignment only. `clampPercent` returns
  // a `Percent` whatever it is handed, so the type system cannot tell a correct
  // bound from a wrong one. Only these cases can.
  it.each([
    ['above the range', 150, 100],
    ['at the upper edge', 100, 100],
    ['below the range', -5, 0],
    ['at the lower edge', 0, 0],
    ['inside the range', 73, 73],
  ])('clamps a score %s (%i -> %i)', async (_label, sent, expected) => {
    const { row } = await persistedStory(sent);
    expect(row.relevanceScorePct).toBe(expected);
  });

  it('bounds a non-finite score to 0 rather than writing NaN into a NOT NULL integer', async () => {
    // Pre-rename this was `Math.min(100, Math.max(0, s.relevanceScore))`, which
    // propagates `NaN` for a missing or non-numeric value and fails the insert
    // at the database rather than at the boundary.
    const { row } = await persistedStory('not a number');
    expect(row.relevanceScorePct).toBe(0);
    expect(Number.isNaN(row.relevanceScorePct)).toBe(false);
  });
});

describe('WIC-1520 — the wire field is `relevanceScorePct`', () => {
  it('emits `relevanceScorePct` and carries no `relevanceScore` for a prep story', async () => {
    readStub([storyRow()]);

    const { interviewPrep } = await getInterviewPrep(PREP_ID, CALLER);
    const [story] = interviewPrep.stories;

    expect(story.relevanceScorePct).toBe(92);
    // The acceptance criterion is an *absence*: "no response carries
    // `relevanceScore` for a prep story". `toBeUndefined()` would also pass on a
    // DTO that spreads the row and happens to have no such column, so assert the
    // key is absent from the serialised payload the client actually receives.
    expect(Object.keys(story)).toContain('relevanceScorePct');
    expect(Object.keys(story)).not.toContain('relevanceScore');
    expect(JSON.parse(JSON.stringify(interviewPrep))).not.toHaveProperty(
      'stories.0.relevanceScore'
    );
  });

  it('re-clamps a stored row that predates the bound', async () => {
    readStub([storyRow({ relevanceScorePct: 140 })]);
    const { interviewPrep } = await getInterviewPrep(PREP_ID, CALLER);
    expect(interviewPrep.stories[0].relevanceScorePct).toBe(100);
  });
});

describe('WIC-1520 — the markdown export still renders `/100`', () => {
  it('writes `**Relevance Score:** <n>/100`', async () => {
    readStub([storyRow()]);

    const { buffer } = await exportInterviewPrep(PREP_ID, 'markdown', ['stories'], CALLER);
    const md = buffer.toString('utf8');

    // The whole line, not just `/100`. This is the site ADR-008 §3 names as
    // undefended by the brand: interpolation erases it, so swapping the story
    // field here for a ratio would render `0.92/100` with no type error.
    expect(md).toContain('**Relevance Score:** 92/100');
    expect(md).not.toContain('undefined/100');
    expect(md).not.toContain('NaN/100');
  });
});

describe('WIC-1520 — the column and the migration agree', () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL('../src/db/migrations/0020_prep_relevance_score_pct.sql', import.meta.url)
    ),
    'utf8'
  );

  it('declares the column as `relevance_score_pct`', () => {
    expect(interviewPrepStories.relevanceScorePct.name).toBe('relevance_score_pct');
    // The pre-rename name must be gone from the table entirely, or a stale read
    // path would keep compiling.
    expect(Object.keys(interviewPrepStories)).not.toContain('relevanceScore');
  });

  it('renames rather than converts — no type change, no value backfill', () => {
    expect(migration).toMatch(
      /ALTER TABLE interview_prep_stories RENAME COLUMN relevance_score TO relevance_score_pct/
    );
    // ADR-008 §4's argument is that `RENAME COLUMN` moves no data. A migration
    // that also rewrote values would defeat it silently.
    expect(migration).not.toMatch(/\bUPDATE\s+interview_prep_stories\b/i);
    expect(migration).not.toMatch(/ALTER COLUMN\s+relevance_score/i);
  });

  it('is a strict no-op when the rename has already been applied', () => {
    // Ungated, a second run raises `column "relevance_score" does not exist` and
    // fails the deploy's migrate step.
    expect(migration).toMatch(/information_schema\.columns/);
    expect(migration).toMatch(/column_name = 'relevance_score_pct'/);
  });

  it('is registered in the generated drizzle journal', () => {
    // WIC-1963: `meta/_journal.json` is generated from the .sql files, not
    // committed. Assert against the same builder the deploy's migrate step runs,
    // so this gate still means "migration 0020 will actually be applied".
    const migrationsDir = fileURLToPath(new URL('../src/db/migrations', import.meta.url));
    const sqlFileNames = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
    const entries = buildJournalEntries(sqlFileNames);
    const entry = entries.find((e) => e.tag === '0020_prep_relevance_score_pct');
    expect(
      entry,
      'migration 0020 is absent from the generated journal and will never run'
    ).toBeDefined();
    expect(entry!.idx).toBe(20);
  });
});
