/**
 * WIC-1487 — `upload_id` correlates all three `resume_upload_*` legs.
 *
 * The failure KPI of record (dashboard-spec.md §6) is *gap-derived*: a
 * `resume_upload_submitted` with no matching terminal event is a failure. That join
 * needs a key present on every leg. `session_id` is one-to-many over uploads, and
 * `resume_id` / `export_id` are generated *by* the work that may fail, so `upload_id`
 * is the only candidate.
 *
 * These assertions are the only enforcement that exists. `track()` takes
 * `Record<string, unknown>`, so the `ResumeUpload*Props` interfaces in
 * analytics.service.ts are documentation — `tsc` does not check emit callsites against
 * them, and a dropped or misspelled `upload_id` compiles clean.
 *
 * Every test below asserts the *shared value*, never mere presence: an assertion that
 * `upload_id` is defined is satisfied by a hardcoded constant, which would join every
 * upload in the account to every other and silently produce the exact aggregate-only
 * metric this ticket removes. `emits a distinct upload_id per call` is the negative
 * control for that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Document, Packer, Paragraph } from 'docx';

vi.mock('../src/db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../src/services/analytics.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/analytics.service.js')>()),
  track: vi.fn(),
}));
vi.mock('../src/services/storage.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/storage.service.js')>()),
  isR2Configured: vi.fn(() => true),
  isStorageAvailable: vi.fn(() => true),
  uploadObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
  buildObjectKey: vi.fn((userId: string | null, kind: string, name: string) =>
    [userId ?? 'anon', kind, name].join('/')
  ),
}));
vi.mock('../src/services/ai-parser.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/ai-parser.service.js')>()),
  isAIParserAvailable: vi.fn(() => false),
  parseResumeWithAI: vi.fn(),
  generateAIProjectMarkdown: vi.fn(() => ''),
}));
vi.mock('../src/services/change-queue.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/change-queue.service.js')>()),
  enqueueChange: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined),
}));
vi.mock('../src/services/project.service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/project.service.js')>()),
  getOrCreateProjectBySlug: vi.fn(async (slug: string) => ({ id: 'proj-1', slug })),
}));

import { uploadResume } from '../src/services/resume.service.js';
import { getDb } from '../src/db/client.js';
import { track } from '../src/services/analytics.service.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function buildDocx(): Promise<Buffer> {
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph('Experience'),
            new Paragraph('Acme Corp - Senior Dev 2022-2024'),
            new Paragraph('- Built microservices'),
          ],
        },
      ],
    })
  );
}

/**
 * Minimal Drizzle stub. `selectRows` is what the duplicate-detection query returns:
 * a non-empty array drives the duplicate short-circuit, an empty one the full pipeline.
 */
function stubDb(selectRows: unknown[] = []) {
  // `toDTO` / `exportToDTO` call `.toISOString()` on these, so every row needs them
  // whether it came from a select or an insert...returning().
  const dates = { uploadedAt: new Date(), generatedAt: new Date(), createdAt: new Date() };
  const rows = selectRows.map((r) => ({ ...dates, metadata: {}, ...(r as object) }));
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => rows,
    then: (resolve: (v: unknown) => unknown) => resolve(rows),
  };
  return {
    select: () => selectChain,
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => [{ ...dates, metadata: {}, version: 1, ...v }],
        onConflictDoNothing: () => ({ returning: async () => [] }),
      }),
    }),
  };
}

/** All props passed to `track()` for one event name, in emit order. */
function propsFor(event: string): Array<Record<string, unknown>> {
  return vi
    .mocked(track)
    .mock.calls.filter((c) => c[0] === event)
    .map((c) => c[1] as Record<string, unknown>);
}

describe('WIC-1487 — upload_id correlates the three resume_upload legs', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    vi.mocked(getDb).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shares one upload_id between _submitted and _completed on the full pipeline', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getDb).mockReturnValue(stubDb([]) as any);

    await uploadResume(await buildDocx(), 'cv.docx', DOCX_MIME, 'user-1', 'sess-1');

    const submitted = propsFor('resume_upload_submitted');
    const completed = propsFor('resume_upload_completed');
    // Exactly one terminal leg — a pipeline throw would add a _failed and make a
    // naive "ids match" assertion pass against the wrong pair of events.
    expect(propsFor('resume_upload_failed')).toHaveLength(0);
    expect(submitted).toHaveLength(1);
    expect(completed).toHaveLength(1);

    expect(completed[0].is_duplicate).toBe(false);
    expect(submitted[0].upload_id).toEqual(expect.any(String));
    expect(submitted[0].upload_id).not.toBe('');
    expect(completed[0].upload_id).toBe(submitted[0].upload_id);
    // Distinct from the ids generated by the work itself — those cannot appear on
    // _submitted or _failed, which is the whole reason upload_id exists.
    expect(completed[0].upload_id).not.toBe(completed[0].resume_id);
    expect(completed[0].upload_id).not.toBe(completed[0].export_id);
  });

  it('shares one upload_id between _submitted and _completed on the duplicate short-circuit', async () => {
    vi.mocked(getDb).mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stubDb([{ id: 'existing-resume', userId: 'user-1', createdAt: new Date() }]) as any
    );

    await uploadResume(await buildDocx(), 'cv.docx', DOCX_MIME, 'user-1', 'sess-2');

    const submitted = propsFor('resume_upload_submitted');
    const completed = propsFor('resume_upload_completed');
    expect(propsFor('resume_upload_failed')).toHaveLength(0);
    expect(submitted).toHaveLength(1);
    expect(completed).toHaveLength(1);

    // This is the second _completed callsite, which is easy to miss: it returns early
    // and never reaches the one at the end of the try body.
    expect(completed[0].is_duplicate).toBe(true);
    expect(completed[0].resume_id).toBe('existing-resume');
    expect(completed[0].upload_id).toBe(submitted[0].upload_id);
  });

  it('shares one upload_id between _submitted and _failed when the pipeline throws', async () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('db exploded');
    });

    await expect(
      uploadResume(await buildDocx(), 'cv.docx', DOCX_MIME, 'user-1', 'sess-3')
    ).rejects.toThrow('db exploded');

    const submitted = propsFor('resume_upload_submitted');
    const failed = propsFor('resume_upload_failed');
    expect(propsFor('resume_upload_completed')).toHaveLength(0);
    expect(submitted).toHaveLength(1);
    expect(failed).toHaveLength(1);

    // The failure leg is the one the gap metric exists to recover, so its correlation
    // is the load-bearing case: upload_id must survive into the catch block.
    expect(failed[0].upload_id).toBe(submitted[0].upload_id);
    expect(failed[0].error_stage).toBe('upload');
  });

  it('emits a distinct upload_id per call, so uploads in one session do not net out', async () => {
    // Negative control. Every other test in this file passes against
    // `const uploadId = 'constant'`; this one does not. A shared constant would join
    // all uploads to each other and reintroduce the aggregate-only limitation
    // (dashboard-spec.md §6.5) that this change removes — a second upload's
    // _completed would cancel a first upload's unmatched _submitted.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getDb).mockReturnValue(stubDb([]) as any);
    const buf = await buildDocx();

    // Same session id and byte-identical file: nothing but the generator distinguishes them.
    await uploadResume(buf, 'cv.docx', DOCX_MIME, 'user-1', 'sess-same');
    await uploadResume(buf, 'cv.docx', DOCX_MIME, 'user-1', 'sess-same');

    const ids = propsFor('resume_upload_submitted').map((p) => p.upload_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);

    // And each terminal leg joins to its own submit, not merely to "some" submit.
    const completedIds = propsFor('resume_upload_completed').map((p) => p.upload_id);
    expect(completedIds).toEqual(ids);
  });
});
