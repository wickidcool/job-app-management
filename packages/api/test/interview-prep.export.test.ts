import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportInterviewPrep } from '../src/services/interviewPrep.service.js';
import { EXPORT_BYLINE } from '../src/constants/product.js';

vi.mock('../src/db/client.js', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '../src/db/client.js';

/**
 * `exportInterviewPrep` issues three `select`s (prep, stories, application) and one
 * `update`. Each is a drizzle builder chain that is awaited at the end, so one thenable
 * that returns itself from every builder method covers all four; `select` shifts the next
 * row set off a queue in call order.
 */
function stubDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  const chain = (rows: unknown[]): Record<string, unknown> => {
    const self: Record<string, unknown> = {
      from: () => self,
      where: () => self,
      set: () => self,
      limit: () => self,
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  return {
    select: () => chain(queue.shift() ?? []),
    update: () => chain([]),
  };
}

const PREP = {
  id: '01HXK5R3J7Q8N2M4P6W9Y1Z3P1',
  applicationId: '01HXK5R3J7Q8N2M4P6W9Y1Z3A1',
  interviewType: 'behavioral',
  timeAvailable: '30min',
  generatedQuestions: [],
  gapMitigations: [],
  quickReference: null,
};

const APP = { jobTitle: 'Senior Full Stack Engineer', company: 'Acme Corp' };

describe('exportInterviewPrep — attribution (WIC-1953)', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue(
      stubDb([[PREP], [], [APP]]) as unknown as ReturnType<typeof getDb>
    );
  });

  it.each(['markdown', 'print', 'pdf'] as const)(
    'stamps the byline on the %s export',
    async (format) => {
      const { buffer } = await exportInterviewPrep(PREP.id, format);
      expect(buffer.toString('utf8')).toContain(EXPORT_BYLINE);
    }
  );

  it('puts the byline at the foot, below the content — not under the title', async () => {
    const { buffer } = await exportInterviewPrep(PREP.id, 'markdown');
    const md = buffer.toString('utf8');

    expect(md.trimEnd().endsWith(`*${EXPORT_BYLINE}*`)).toBe(true);
    // The document's own title and metadata line still come first, unchanged.
    expect(md.indexOf(`# Interview Prep — ${APP.jobTitle} at ${APP.company}`)).toBe(0);
    expect(md.indexOf('*Generated ')).toBeLessThan(md.indexOf(EXPORT_BYLINE));
  });

  it('is the ruled string exactly — apex domain, em dash, no date, no period', () => {
    // Pinned against the literal rather than the constant: the point is to fail when the
    // copy changes, which a constant-to-constant comparison cannot do. Ruled under
    // WIC-1953, recorded in docs/design/CONTENT_STYLE.md.
    expect(EXPORT_BYLINE).toBe('Generated with Careerpin — careerpin.app');
    expect(EXPORT_BYLINE).not.toContain('app.careerpin.app');
  });

  it('leaves the print document title as the user’s own, not `{Page} — Careerpin`', async () => {
    const { buffer } = await exportInterviewPrep(PREP.id, 'print');
    const html = buffer.toString('utf8');

    expect(html).toContain(`<title>Interview Prep — ${APP.jobTitle} at ${APP.company}</title>`);
    expect(html).not.toContain('<title>Interview Prep — Careerpin</title>');
    // …and the byline still reaches the rendered body.
    expect(html).toContain(`<em>${EXPORT_BYLINE}</em>`);
  });
});
