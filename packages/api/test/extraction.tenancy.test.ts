/**
 * WIC-1404 — catalog extraction and auto-apply must be user-scoped.
 *
 * These run against **PGlite**, a real Postgres engine compiled to WASM, not a
 * stub. That is deliberate and is the point of the file. The defect under test
 * is a missing WHERE predicate, and a hand-rolled `db` stub resolves whatever
 * rows it was primed with regardless of the predicate it is handed — WIC-1373
 * shipped two tenancy assertions that passed *with* the bug for exactly that
 * reason. Only a real planner can tell `WHERE tag_slug = 'react'` (matches every
 * tenant, no LIMIT) apart from `WHERE tag_slug = 'react' AND user_id = $1`.
 *
 * The DDL below mirrors `db/schema.ts` after migration 0017: `user_id NOT NULL`
 * on the catalog tables, and the global slug uniques replaced by composite
 * `(user_id, slug)` uniques. That composite is what makes the unscoped UPDATE
 * reachable at all — several tenants may legitimately hold the same slug.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';

let db: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock('../src/db/client.js', () => ({
  // Lazy: `db` is assigned in beforeAll, long after this factory is hoisted.
  getDb: () => db,
  closeDb: async () => {},
}));

// Storage is stubbed *available* on purpose. Only the cross-tenant-read case
// omits `rawText` and so actually reaches this; if the fetch could not succeed
// the assertion "no text was extracted" would hold for the wrong reason — the
// document would be unreadable rather than out of scope — and the test would
// stay green with the predicate removed.
vi.mock('../src/services/storage.service.js', () => ({
  isStorageAvailable: () => true,
  // The object body is the file path, so extractText below can return text that
  // differs per document. Needed to tell "B read A's file" from "B read some
  // file" — with one fixed body every resume yields identical prose and the
  // disclosure is invisible.
  getObject: async (path: string) => Buffer.from(path),
}));

// Same reasoning: extractText is real pdfjs/mammoth and cannot parse a stub
// buffer. Everything else in resume.service (parseResumeText,
// extractExperienceEntries) stays real, since extraction depends on it.
vi.mock('../src/services/resume.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/resume.service.js')>();
  return {
    ...actual,
    extractText: async (content: Buffer) =>
      TEXT_BY_FILE_PATH.get(content.toString()) ?? RESUME_TEXT,
  };
});

/** Per-document resume prose, keyed by `filePath`. Empty ⇒ everyone gets RESUME_TEXT. */
const TEXT_BY_FILE_PATH = new Map<string, string>();

const { processCatalogChange } = await import('../src/services/extraction.service.js');
const { applyDiff, generateDiff } = await import('../src/services/catalog.service.js');
const {
  companyCatalog,
  techStackTags,
  jobFitTags,
  recurringThemes,
  applications,
  resumes,
  catalogDiffs,
} = await import('../src/db/schema.js');

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

const SCHEMA_DDL = `
CREATE TYPE app_status AS ENUM ('saved','applied','phone_screen','interview','offer','rejected','withdrawn');
CREATE TYPE job_fit_category AS ENUM ('role','industry','seniority','work_style','uncategorized');
CREATE TYPE tech_stack_category AS ENUM ('language','frontend','backend','database','cloud','devops','ai_ml','uncategorized');
CREATE TYPE metric_type AS ENUM ('percentage','currency','count','time','multiplier');
CREATE TYPE impact_category AS ENUM ('revenue','cost_savings','efficiency','team_leadership','user_growth','performance','other');
CREATE TYPE change_action AS ENUM ('create','update','delete','merge');
CREATE TYPE diff_status AS ENUM ('pending','approved','rejected','partial','expired');

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  user_id UUID,
  job_title TEXT NOT NULL,
  company TEXT NOT NULL,
  url TEXT,
  location TEXT,
  salary_range TEXT,
  status app_status NOT NULL DEFAULT 'saved',
  cover_letter_id TEXT,
  resume_version_id TEXT,
  applied_at TIMESTAMPTZ,
  contact TEXT,
  comp_target TEXT,
  next_action TEXT,
  next_action_due DATE,
  job_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE resumes (
  id TEXT PRIMARY KEY,
  user_id UUID,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content_hash TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE company_catalog (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL,
  application_count INTEGER NOT NULL DEFAULT 0,
  latest_status app_status,
  latest_app_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_company_catalog_user_normalized ON company_catalog(user_id, normalized_name);

CREATE TABLE tech_stack_tags (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  tag_slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category tech_stack_category NOT NULL DEFAULT 'uncategorized',
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  mention_count INTEGER NOT NULL DEFAULT 0,
  version_mentioned TEXT,
  is_legacy BOOLEAN NOT NULL DEFAULT false,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  review_options JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_tech_stack_tags_user_slug ON tech_stack_tags(user_id, tag_slug);

CREATE TABLE job_fit_tags (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  tag_slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category job_fit_category NOT NULL DEFAULT 'uncategorized',
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  mention_count INTEGER NOT NULL DEFAULT 0,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  review_options JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_job_fit_tags_user_slug ON job_fit_tags(user_id, tag_slug);

CREATE TABLE quantified_bullets (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  action_verb TEXT,
  metric_type metric_type NOT NULL,
  metric_value NUMERIC NOT NULL,
  metric_range JSONB,
  is_approximate BOOLEAN NOT NULL DEFAULT false,
  secondary_metric_type metric_type,
  secondary_metric_value NUMERIC,
  impact_category impact_category NOT NULL DEFAULT 'other',
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE recurring_themes (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  theme_slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  occurrence_count INTEGER NOT NULL DEFAULT 0,
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  example_excerpts JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_core_strength BOOLEAN NOT NULL DEFAULT false,
  is_historical BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX idx_recurring_themes_user_slug ON recurring_themes(user_id, theme_slug);

CREATE TABLE catalog_change_log (
  id TEXT PRIMARY KEY,
  user_id UUID,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action change_action NOT NULL,
  before_state JSONB,
  after_state JSONB,
  trigger_source TEXT NOT NULL,
  trigger_id TEXT,
  diff_id TEXT,
  committed BOOLEAN NOT NULL DEFAULT false,
  committed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE catalog_diffs (
  id TEXT PRIMARY KEY,
  user_id UUID,
  trigger_source TEXT NOT NULL,
  trigger_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes JSONB NOT NULL,
  pending_review JSONB NOT NULL DEFAULT '[]'::jsonb,
  status diff_status NOT NULL DEFAULT 'pending',
  user_decisions JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);
`;

/** A resume body that trips the `react` tech tag and the `mentor` theme. */
const RESUME_TEXT = 'Built dashboards in React. Mentored two engineers on the platform team.';

function resumeEvent(sourceId: string, userId: string | null, text = RESUME_TEXT) {
  return {
    id: `evt_${sourceId}`,
    sourceType: 'resume' as const,
    sourceId,
    changeType: 'created' as const,
    timestamp: new Date().toISOString(),
    metadata: { rawText: text, userId },
  };
}

beforeAll(async () => {
  client = new PGlite();
  db = drizzle(client);
  await client.exec(SCHEMA_DDL);
});

beforeEach(async () => {
  TEXT_BY_FILE_PATH.clear();
  await client.exec(`
    TRUNCATE catalog_diffs, catalog_change_log, recurring_themes, quantified_bullets,
             job_fit_tags, tech_stack_tags, company_catalog, resumes, applications CASCADE;
  `);
});

async function seedResume(id: string, userId: string) {
  await db.insert(resumes).values({
    id,
    userId,
    fileName: `${id}.pdf`,
    fileSize: 1024,
    mimeType: 'application/pdf',
    filePath: `${userId}/resume/${id}.pdf`,
  });
}

describe("WIC-1404 AC-1 — one tenant's tag does not suppress another's", () => {
  it("gives user B their own react row and leaves user A's byte-identical", async () => {
    await seedResume('01RESUME_A', USER_A);
    await seedResume('01RESUME_B', USER_B);

    // User A uploads first and legitimately acquires `react`.
    await processCatalogChange(resumeEvent('01RESUME_A', USER_A));

    const [before] = await db.select().from(techStackTags).where(eq(techStackTags.userId, USER_A));
    expect(before, 'user A should own a react tag after their own upload').toBeDefined();
    expect(before.tagSlug).toBe('react');
    expect(before.sourceIds).toEqual(['01RESUME_A']);

    // User B uploads a resume mentioning the same technology.
    await processCatalogChange(resumeEvent('01RESUME_B', USER_B));

    const bTags = await db.select().from(techStackTags).where(eq(techStackTags.userId, USER_B));
    const bReact = bTags.find((t) => t.tagSlug === 'react');
    expect(bReact, 'user B must get their own react row, not be silently skipped').toBeDefined();
    expect(bReact!.sourceIds).toEqual(['01RESUME_B']);
    expect(bReact!.mentionCount).toBe(1);

    // AC-1: A's row is untouched on every mutable column.
    const [after] = await db.select().from(techStackTags).where(eq(techStackTags.userId, USER_A));
    expect(after.mentionCount).toBe(before.mentionCount);
    expect(after.sourceIds).toEqual(before.sourceIds);
    expect(after.version).toBe(before.version);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("AC-2 — user A's sourceIds never name a document user A does not own", async () => {
    await seedResume('01RESUME_A', USER_A);
    await seedResume('01RESUME_B', USER_B);
    await processCatalogChange(resumeEvent('01RESUME_A', USER_A));
    await processCatalogChange(resumeEvent('01RESUME_B', USER_B));

    const aOwned = new Set(
      (await db.select().from(resumes).where(eq(resumes.userId, USER_A))).map((r) => r.id)
    );
    const aTags = await db.select().from(techStackTags).where(eq(techStackTags.userId, USER_A));
    expect(aTags.length).toBeGreaterThan(0);
    for (const tag of aTags) {
      for (const sourceId of tag.sourceIds) {
        expect(aOwned.has(sourceId), `${tag.tagSlug} leaked source ${sourceId}`).toBe(true);
      }
    }
  });

  it("a second upload by the same user still increments that user's own row", async () => {
    await seedResume('01RESUME_A1', USER_A);
    await seedResume('01RESUME_A2', USER_A);
    await processCatalogChange(resumeEvent('01RESUME_A1', USER_A));
    await processCatalogChange(resumeEvent('01RESUME_A2', USER_A));

    const rows = await db.select().from(techStackTags).where(eq(techStackTags.tagSlug, 'react'));
    expect(rows).toHaveLength(1);
    expect(rows[0].mentionCount).toBe(2);
    expect([...rows[0].sourceIds].sort()).toEqual(['01RESUME_A1', '01RESUME_A2']);
  });
});

/**
 * WIC-1406 — `job_fit_tags` is the fourth entity `processCatalogChange` dedups
 * and `applyChangeToDb` updates, and it was the one entity the WIC-1404 suite
 * never exercised. `RESUME_TEXT` trips a tech tag and a theme but no JOB_FIT
 * pattern, so zero job-fit rows existed in any test: reverting *both* jobFit
 * predicates (the `existingJobFitSlugs` read and the `update` WHERE) left all
 * nine tests green. Measured, not assumed — the mutation was run.
 *
 * The text below trips `software-engineering` (role) and `senior` (seniority).
 */
const JOB_FIT_TEXT = 'Senior software engineer building dashboards in React.';

describe('WIC-1406 — job_fit_tags dedup and update are per tenant', () => {
  it("gives user B their own job-fit row and leaves user A's byte-identical", async () => {
    await seedResume('01RESUME_A', USER_A);
    await seedResume('01RESUME_B', USER_B);

    await processCatalogChange(resumeEvent('01RESUME_A', USER_A, JOB_FIT_TEXT));

    const aBefore = await db.select().from(jobFitTags).where(eq(jobFitTags.userId, USER_A));
    const aSwe = aBefore.find((t) => t.tagSlug === 'software-engineering');
    expect(
      aSwe,
      'user A should own a software-engineering tag after their own upload'
    ).toBeDefined();
    expect(aSwe!.sourceIds).toEqual(['01RESUME_A']);
    expect(aSwe!.mentionCount).toBe(1);

    await processCatalogChange(resumeEvent('01RESUME_B', USER_B, JOB_FIT_TEXT));

    // With the unscoped read, B's slug is already "taken" globally, so B takes
    // the update branch and ends up with no row of their own at all.
    const bTags = await db.select().from(jobFitTags).where(eq(jobFitTags.userId, USER_B));
    const bSwe = bTags.find((t) => t.tagSlug === 'software-engineering');
    expect(bSwe, 'user B must get their own row, not be silently skipped').toBeDefined();
    expect(bSwe!.sourceIds).toEqual(['01RESUME_B']);
    expect(bSwe!.mentionCount).toBe(1);

    // ...and with the unscoped UPDATE, that update branch lands on A's row.
    const [aAfter] = (
      await db.select().from(jobFitTags).where(eq(jobFitTags.userId, USER_A))
    ).filter((t) => t.tagSlug === 'software-engineering');
    expect(aAfter.mentionCount).toBe(aSwe!.mentionCount);
    expect(aAfter.sourceIds).toEqual(aSwe!.sourceIds);
    expect(aAfter.version).toBe(aSwe!.version);
    expect(aAfter.updatedAt.getTime()).toBe(aSwe!.updatedAt.getTime());
  });

  it("user A's job-fit sourceIds never name a document user A does not own", async () => {
    await seedResume('01RESUME_A', USER_A);
    await seedResume('01RESUME_B', USER_B);
    await processCatalogChange(resumeEvent('01RESUME_A', USER_A, JOB_FIT_TEXT));
    await processCatalogChange(resumeEvent('01RESUME_B', USER_B, JOB_FIT_TEXT));

    const aTags = await db.select().from(jobFitTags).where(eq(jobFitTags.userId, USER_A));
    expect(aTags.length, 'the run must actually produce job-fit tags').toBeGreaterThan(0);
    for (const tag of aTags) {
      expect(tag.sourceIds, `${tag.tagSlug} leaked a foreign source`).not.toContain('01RESUME_B');
    }
  });

  it("a second upload by the same user still increments that user's own row", async () => {
    // Single-tenant control: scoping must not break legitimate dedup.
    await seedResume('01RESUME_A1', USER_A);
    await seedResume('01RESUME_A2', USER_A);
    await processCatalogChange(resumeEvent('01RESUME_A1', USER_A, JOB_FIT_TEXT));
    await processCatalogChange(resumeEvent('01RESUME_A2', USER_A, JOB_FIT_TEXT));

    const rows = await db
      .select()
      .from(jobFitTags)
      .where(eq(jobFitTags.tagSlug, 'software-engineering'));
    expect(rows).toHaveLength(1);
    expect(rows[0].mentionCount).toBe(2);
    expect([...rows[0].sourceIds].sort()).toEqual(['01RESUME_A1', '01RESUME_A2']);
  });
});

describe('WIC-1404 AC-3 — company_catalog is per tenant', () => {
  async function seedApplication(id: string, userId: string, company: string) {
    await db.insert(applications).values({ id, userId, jobTitle: 'Engineer', company });
  }

  function appEvent(sourceId: string, userId: string | null) {
    return {
      id: `evt_${sourceId}`,
      sourceType: 'application' as const,
      sourceId,
      changeType: 'created' as const,
      timestamp: new Date().toISOString(),
      metadata: { userId },
    };
  }

  async function seedCompany(id: string, userId: string, latestAppId: string | null) {
    await db.insert(companyCatalog).values({
      id,
      userId,
      name: 'Acme Corp',
      normalizedName: 'acme-corp',
      firstSeenAt: new Date('2026-01-01T00:00:00Z'),
      applicationCount: 1,
      latestStatus: 'saved',
      latestAppId,
    });
  }

  it("leaves A's row byte-identical and proposes a create for B, not an update", async () => {
    await seedApplication('01APP_A', USER_A, 'Acme Corp');
    await seedApplication('01APP_B', USER_B, 'Acme Corp');
    await seedCompany('01CO_A', USER_A, '01APP_A');

    const [aBefore] = await db
      .select()
      .from(companyCatalog)
      .where(eq(companyCatalog.userId, USER_A));

    await processCatalogChange(appEvent('01APP_B', USER_B));

    // AC-3, first half: A's row is untouched on every mutable column. Before the
    // fix the slug-only lookup found A's acme-corp, so B's event was emitted as
    // an `update` and auto-applied straight onto this row.
    const [aAfter] = await db
      .select()
      .from(companyCatalog)
      .where(eq(companyCatalog.userId, USER_A));
    expect(aAfter.applicationCount).toBe(aBefore.applicationCount);
    expect(aAfter.version).toBe(aBefore.version);
    expect(aAfter.updatedAt.getTime()).toBe(aBefore.updatedAt.getTime());
    // The sharpest form of the leak: B's application ULID on A's row.
    expect(aAfter.latestAppId).toBe('01APP_A');

    // B's event must now be a `create`. New companies are held for review
    // (`hasNewCompany` suppresses auto-apply — pre-existing behaviour, untouched
    // here), so B's row arrives when the diff is approved rather than instantly.
    const [diff] = await db.select().from(catalogDiffs).where(eq(catalogDiffs.userId, USER_B));
    expect(diff, "B's run must produce a diff of its own").toBeDefined();
    expect(diff.status).toBe('pending');
    const companyChanges = (diff.changes as Array<{ entity: string; action: string }>).filter(
      (c) => c.entity === 'company_catalog'
    );
    expect(companyChanges).toHaveLength(1);
    expect(companyChanges[0].action).toBe('create');

    // AC-3, second half: approving it gives B their own row, and still not A's.
    await applyDiff(diff.id, { action: 'approve_all' }, USER_B);
    const [bRow] = await db.select().from(companyCatalog).where(eq(companyCatalog.userId, USER_B));
    expect(bRow, 'user B must end up with their own company row').toBeDefined();
    expect(bRow.normalizedName).toBe('acme-corp');
    expect(bRow.id).not.toBe('01CO_A');

    const [aFinal] = await db
      .select()
      .from(companyCatalog)
      .where(eq(companyCatalog.userId, USER_A));
    expect(aFinal.applicationCount).toBe(aBefore.applicationCount);
    expect(aFinal.latestAppId).toBe('01APP_A');
  });

  it('a second application by the same user increments only their own row', async () => {
    await seedApplication('01APP_A1', USER_A, 'Acme Corp');
    await seedApplication('01APP_A2', USER_A, 'Acme Corp');
    await seedApplication('01APP_B1', USER_B, 'Acme Corp');
    await seedCompany('01CO_A', USER_A, '01APP_A1');
    await seedCompany('01CO_B', USER_B, '01APP_B1');

    // Both tenants hold `acme-corp` — legal under the 0017 composite unique, and
    // the exact shape that makes an unscoped `WHERE normalized_name = $1` a
    // two-row UPDATE.
    await processCatalogChange(appEvent('01APP_A2', USER_A));

    const [aRow] = await db.select().from(companyCatalog).where(eq(companyCatalog.userId, USER_A));
    const [bRow] = await db.select().from(companyCatalog).where(eq(companyCatalog.userId, USER_B));
    expect(aRow.applicationCount).toBe(2);
    expect(aRow.latestAppId).toBe('01APP_A2');
    expect(bRow.applicationCount).toBe(1);
    expect(bRow.latestAppId).toBe('01APP_B1');
    expect(bRow.version).toBe(1);
  });
});

describe("WIC-1404 AC-4 — is_core_strength is computed from the owner's documents only", () => {
  it("leaves A's theme below the core-strength threshold when B contributes", async () => {
    await seedResume('01RESUME_A1', USER_A);
    await seedResume('01RESUME_A2', USER_A);
    await seedResume('01RESUME_B', USER_B);

    // Two of A's own documents mention mentorship -> occurrence_count 2, not core yet.
    await processCatalogChange(resumeEvent('01RESUME_A1', USER_A));
    await processCatalogChange(resumeEvent('01RESUME_A2', USER_A));

    const [aBefore] = await db
      .select()
      .from(recurringThemes)
      .where(eq(recurringThemes.userId, USER_A));
    expect(aBefore.themeSlug).toBe('mentorship');
    expect(aBefore.occurrenceCount).toBe(2);
    expect(aBefore.isCoreStrength).toBe(false);

    // B's document must not be the third occurrence that promotes A's theme.
    await processCatalogChange(resumeEvent('01RESUME_B', USER_B));

    const [aAfter] = await db
      .select()
      .from(recurringThemes)
      .where(eq(recurringThemes.userId, USER_A));
    expect(aAfter.occurrenceCount).toBe(2);
    expect(aAfter.isCoreStrength).toBe(false);
    expect(aAfter.sourceIds).not.toContain('01RESUME_B');

    // ...and B is not silently skipped: an unscoped existence read routes B's
    // run to `update`, whose scoped WHERE then matches nothing at all, so B
    // ends up with no row rather than with A's. Without this the whole test
    // survives reverting `existingThemeSlugs`' scoping.
    const [bTheme] = await db
      .select()
      .from(recurringThemes)
      .where(eq(recurringThemes.userId, USER_B));
    expect(bTheme, 'user B must get their own mentorship row').toBeDefined();
    expect(bTheme.sourceIds).toEqual(['01RESUME_B']);
  });
});

/*
 * Once the existence reads are scoped, the create/update decision is per tenant,
 * so in every fixture above the `update` branch only ever fires same-tenant and
 * its own WHERE is never tested against a foreign row. Three of the four update
 * predicates therefore survive being reverted with the suite fully green — the
 * company one is caught only because AC-3's second test happens to seed both
 * tenants with `acme-corp`. This does for the other three what that test does
 * for companies: seed a co-resident row first, then assert it is untouched.
 */
describe('WIC-1404 — the update predicates, exercised against a co-resident row', () => {
  it("increments only the uploader's row when both tenants hold the same slug", async () => {
    await seedResume('01RESUME_A1', USER_A);
    await seedResume('01RESUME_A2', USER_A);
    await processCatalogChange(
      resumeEvent('01RESUME_A1', USER_A, `${RESUME_TEXT} ${JOB_FIT_TEXT}`)
    );

    // B independently holds all three slugs — legal under the 0017 composites,
    // and the shape that makes a slug-only WHERE a two-row UPDATE.
    await db.insert(techStackTags).values({
      id: '01TECH_B',
      userId: USER_B,
      tagSlug: 'react',
      displayName: 'React',
      category: 'frontend',
      sourceIds: ['01RESUME_B'],
      mentionCount: 1,
    });
    await db.insert(jobFitTags).values({
      id: '01JF_B',
      userId: USER_B,
      tagSlug: 'software-engineering',
      displayName: 'Software Engineering',
      category: 'role',
      sourceIds: ['01RESUME_B'],
      mentionCount: 1,
    });
    await db.insert(recurringThemes).values({
      id: '01THEME_B',
      userId: USER_B,
      themeSlug: 'mentorship',
      displayName: 'Mentorship',
      sourceIds: ['01RESUME_B'],
      occurrenceCount: 1,
    });

    const [techBefore] = await db
      .select()
      .from(techStackTags)
      .where(eq(techStackTags.userId, USER_B));
    const [jfBefore] = await db.select().from(jobFitTags).where(eq(jobFitTags.userId, USER_B));
    const [themeBefore] = await db
      .select()
      .from(recurringThemes)
      .where(eq(recurringThemes.userId, USER_B));

    await processCatalogChange(
      resumeEvent('01RESUME_A2', USER_A, `${RESUME_TEXT} ${JOB_FIT_TEXT}`)
    );

    // Positive direction: A's own rows advanced, so the UPDATEs really ran and
    // the negative assertions below are not vacuous.
    const [techA] = await db.select().from(techStackTags).where(eq(techStackTags.userId, USER_A));
    expect(techA.mentionCount, "A's own update must have run").toBe(2);

    // Negative direction: B's rows byte-identical on every mutable column.
    const [techAfter] = await db
      .select()
      .from(techStackTags)
      .where(eq(techStackTags.userId, USER_B));
    expect(techAfter.mentionCount).toBe(techBefore.mentionCount);
    expect(techAfter.sourceIds).toEqual(techBefore.sourceIds);
    expect(techAfter.version).toBe(techBefore.version);

    const [jfAfter] = await db.select().from(jobFitTags).where(eq(jobFitTags.userId, USER_B));
    expect(jfAfter.mentionCount).toBe(jfBefore.mentionCount);
    expect(jfAfter.sourceIds).toEqual(jfBefore.sourceIds);
    expect(jfAfter.version).toBe(jfBefore.version);

    const [themeAfter] = await db
      .select()
      .from(recurringThemes)
      .where(eq(recurringThemes.userId, USER_B));
    expect(themeAfter.occurrenceCount).toBe(themeBefore.occurrenceCount);
    expect(themeAfter.sourceIds).toEqual(themeBefore.sourceIds);
    expect(themeAfter.isCoreStrength).toBe(false);
    expect(themeAfter.version).toBe(themeBefore.version);
  });
});

describe('WIC-1404 — owner resolution', () => {
  it('falls back to the source row when the enqueuer passes no userId', async () => {
    // application.service.ts enqueued with no metadata at all; the owner has to
    // come off the application row or the run writes into another tenant.
    await db
      .insert(applications)
      .values({ id: '01APP_B', userId: USER_B, jobTitle: 'Engineer', company: 'Acme Corp' });

    await processCatalogChange({
      id: 'evt_no_metadata',
      sourceType: 'application',
      sourceId: '01APP_B',
      changeType: 'created',
      timestamp: new Date().toISOString(),
    });

    // A brand-new company is held for review rather than auto-applied, so the
    // owner shows up on the diff row. Before the fix this landed as user_id
    // null, which no scoped reader can ever see again.
    const diffs = await db.select().from(catalogDiffs);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].userId).toBe(USER_B);
  });

  it('writes nothing at all when no owner can be resolved', async () => {
    await db
      .insert(applications)
      .values({ id: '01APP_ORPHAN', userId: null, jobTitle: 'Engineer', company: 'Acme Corp' });

    await processCatalogChange({
      id: 'evt_orphan',
      sourceType: 'application',
      sourceId: '01APP_ORPHAN',
      changeType: 'created',
      timestamp: new Date().toISOString(),
    });

    // Every catalog table is user_id NOT NULL, so the alternative to skipping is
    // a constraint violation on create and a cross-tenant UPDATE on update.
    expect(await db.select().from(companyCatalog)).toHaveLength(0);
    expect(await db.select().from(catalogDiffs)).toHaveLength(0);
  });

  it('reads no text for a document the resolved owner does not own', async () => {
    // POST /api/catalog/generate-diff takes sourceId from the request body, so
    // the caller can name a resume they do not own. Scoping the document read
    // means the run yields nothing rather than extracting a stranger's resume.
    await seedResume('01RESUME_A', USER_A);

    // Positive control first: the owner's own run, over the same code path with
    // no rawText shortcut, must genuinely read and extract. Without this the
    // assertion below could pass simply because nothing ever reads anything.
    await processCatalogChange({
      id: 'evt_owner_read',
      sourceType: 'resume',
      sourceId: '01RESUME_A',
      changeType: 'created',
      timestamp: new Date().toISOString(),
      metadata: { userId: USER_A },
    });
    const aTags = await db.select().from(techStackTags).where(eq(techStackTags.userId, USER_A));
    expect(aTags.length, 'owner read must actually extract').toBeGreaterThan(0);

    await client.exec('TRUNCATE catalog_diffs, tech_stack_tags, recurring_themes CASCADE;');

    await processCatalogChange({
      id: 'evt_cross_tenant_read',
      sourceType: 'resume',
      sourceId: '01RESUME_A',
      changeType: 'created',
      timestamp: new Date().toISOString(),
      metadata: { userId: USER_B }, // B naming A's resume, no rawText shortcut
    });

    expect(await db.select().from(techStackTags)).toHaveLength(0);
    expect(await db.select().from(catalogDiffs)).toHaveLength(0);
  });
});

/*
 * The test above proves the scoped document read works — but it hand-builds
 * `metadata: { userId }`, and the production entry point does not. `generateDiff`
 * holds the authenticated caller and never forwards it, so `resolveOwnerUserId`
 * falls back to the source row's own owner: the "owner" resolves to the victim
 * and `WHERE resumes.id = $1 AND resumes.user_id = $2` matches by construction.
 * The predicate cannot miss on the one path it was written to defend.
 *
 * Same shape as the application.service.ts miss WIC-1404 fixed, one layer up:
 * a scoping predicate is only as good as the identity its entry point carries.
 * These tests drive generateDiff itself, so no fixture can supply the metadata
 * the route forgets.
 */
describe('WIC-1406 — generateDiff scopes to the caller, not to the named document', () => {
  /** A distinctive line so a leak is identifiable as A's prose, not any prose. */
  const A_PRIVATE_TEXT =
    'Reduced AWS spend by 42% at Stealth Startup. Built dashboards in React. Mentored two engineers.';

  async function seedResumeWithText(id: string, userId: string, text: string) {
    await seedResume(id, userId);
    TEXT_BY_FILE_PATH.set(`${userId}/resume/${id}.pdf`, text);
  }

  it('refuses to build a diff from a resume the caller does not own, and writes nothing', async () => {
    await seedResumeWithText('01RESUME_A', USER_A, A_PRIVATE_TEXT);

    // User B posts /api/catalog/generate-diff naming user A's resume ULID.
    await expect(
      generateDiff('resume', '01RESUME_A', USER_B),
      "B must not receive a diff derived from A's document"
    ).rejects.toThrow(/CatalogDiff/);

    // Nothing was written anywhere: not into A's catalog, not as a diff row.
    expect(await db.select().from(techStackTags)).toHaveLength(0);
    expect(await db.select().from(recurringThemes)).toHaveLength(0);
    expect(await db.select().from(catalogDiffs)).toHaveLength(0);
  });

  it("does not return any of the named resume's prose to a foreign caller", async () => {
    await seedResumeWithText('01RESUME_A', USER_A, A_PRIVATE_TEXT);

    // The `create` shape is the one that carries verbatim resume text in
    // `changes[].data.rawText`, rather than only slugs and ULIDs.
    const result = await generateDiff('resume', '01RESUME_A', USER_B).catch((e: unknown) => e);

    expect(result, 'the foreign call must reject rather than resolve').toBeInstanceOf(Error);
    expect(JSON.stringify(result)).not.toContain('Stealth Startup');
    expect(JSON.stringify(result)).not.toContain('42');
  });

  it("still builds a diff for the owner's own resume", async () => {
    // Positive control. Without it both assertions above would hold on a
    // generateDiff that had simply stopped working for everyone.
    await seedResumeWithText('01RESUME_A', USER_A, A_PRIVATE_TEXT);

    const diff = await generateDiff('resume', '01RESUME_A', USER_A);
    expect(diff.id).toBeDefined();

    const rows = await db.select().from(techStackTags).where(eq(techStackTags.userId, USER_A));
    expect(
      rows.find((t) => t.tagSlug === 'react'),
      "A's own run must extract"
    ).toBeDefined();
  });

  it('does not fall back to the document owner when there is no authenticated caller', async () => {
    // SUPERSEDED, deliberately. WIC-1406 originally pinned the opposite here: an
    // absent caller fell back to the source row's own owner, so local-dev auth
    // bypass kept working. ADR-010 D3/D4 (WIC-1600, implemented by WIC-1638)
    // rules that an absent owner must match zero rows instead — a fallback that
    // resolves the "owner" from the document being named is the cross-tenant
    // read the ADR exists to close.
    //
    // Local dev is not collateral damage: D3 landed in middleware/auth.ts
    // (WIC-1964), so the bypass supplies a real LOCAL_DEV_USER_ID rather than an
    // absence. Local dev without Supabase config is therefore a tenant that runs
    // this same owner branch, not an owner-less caller taking a 401.
    //
    // In production this service call is unreachable with an absent owner --
    // requireOwner(c) at POST /catalog/generate-diff rejects first -- so this
    // case pins the service-level posture directly rather than through a route.
    await seedResumeWithText('01RESUME_A', USER_A, A_PRIVATE_TEXT);

    const result = await generateDiff('resume', '01RESUME_A', undefined as unknown as string).catch(
      (e: unknown) => e
    );

    expect(result, 'an ownerless call must reject rather than resolve').toBeInstanceOf(Error);
    expect(JSON.stringify(result)).not.toContain('Stealth Startup');
  });
});

/*
 * `generateDiffSchema` is `z.enum(['resume', 'application'])`, so the endpoint
 * the WIC-1406 tests above defend has a second source type, and an application
 * discloses a different but equally private thing: which company the owner is
 * applying to, the role, and the location. Note the application shape is
 * `status: 'pending'` rather than auto-applied, so the exposure here is the
 * response body rather than a write into the victim's catalog.
 */
describe('WIC-1406 — generateDiff scoping, application source', () => {
  async function seedApp(id: string, userId: string) {
    await db.insert(applications).values({
      id,
      userId,
      jobTitle: 'Staff Engineer',
      company: 'Initech Holdings',
      location: 'Zurich',
    });
  }

  it('refuses to build a diff from an application the caller does not own', async () => {
    await seedApp('01APP_A', USER_A);

    const result = await generateDiff('application', '01APP_A', USER_B).catch((e: unknown) => e);

    expect(result, 'the foreign call must reject rather than resolve').toBeInstanceOf(Error);
    // Not `JSON.stringify(result)`: Error has no enumerable own properties, so
    // that serializes to '{}' and the assertion holds no matter what leaked.
    // The message is the channel a handler would actually surface.
    expect((result as Error).message).not.toContain('Initech');
    expect((result as Error).message).not.toContain('Zurich');
    expect(await db.select().from(catalogDiffs)).toHaveLength(0);
    expect(await db.select().from(companyCatalog)).toHaveLength(0);
  });

  it("still builds a diff for the owner's own application", async () => {
    // Positive control: the assertions above must not hold merely because
    // application-sourced generateDiff stopped working for everyone.
    await seedApp('01APP_A', USER_A);

    const diff = await generateDiff('application', '01APP_A', USER_A);
    expect(
      diff.changes.find((c) => c.entity === 'company_catalog'),
      "the owner's own application must still yield a company entry"
    ).toBeDefined();
  });
});

/*
 * Every other fixture logs `experienceEntries=0`, so the resume-path
 * company_catalog dedup read is never executed — deleting its `userId` term
 * leaves the suite green. Unlike the application-path company read (covered by
 * AC-3), this one is only reached when the resume parses into experience
 * entries, which needs an EXPERIENCE heading.
 */
const RESUME_WITH_EXPERIENCE = [
  'EXPERIENCE',
  'Globex Corporation | Staff Engineer | 2020-2024',
  '- Built dashboards in React.',
  '- Mentored two engineers on the platform team.',
].join('\n');

describe('WIC-1404 — company_catalog scoping on the resume path', () => {
  it("does not touch another tenant's company row when B's resume names the same employer", async () => {
    await seedResume('01RESUME_A', USER_A);
    await seedResume('01RESUME_B', USER_B);

    await processCatalogChange(resumeEvent('01RESUME_A', USER_A, RESUME_WITH_EXPERIENCE));
    const [aBefore] = await db
      .select()
      .from(companyCatalog)
      .where(eq(companyCatalog.userId, USER_A));
    expect(aBefore, 'A must acquire a company row from their own resume').toBeDefined();

    await processCatalogChange(resumeEvent('01RESUME_B', USER_B, RESUME_WITH_EXPERIENCE));

    const [bRow] = await db.select().from(companyCatalog).where(eq(companyCatalog.userId, USER_B));
    expect(bRow, 'B must get their own company row').toBeDefined();

    const [aAfter] = await db
      .select()
      .from(companyCatalog)
      .where(eq(companyCatalog.userId, USER_A));
    expect(aAfter.applicationCount).toBe(aBefore.applicationCount);
    expect(aAfter.version).toBe(aBefore.version);
  });
});
