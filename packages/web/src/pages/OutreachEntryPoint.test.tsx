import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import coverLetterDetailSource from './CoverLetterDetail.tsx?raw';
import { CoverLetterDetail } from './CoverLetterDetail';
import { OutreachNew } from './OutreachNew';
import {
  useCoverLetter,
  useDeleteCoverLetter,
  useExportCoverLetter,
  useGenerateOutreach,
} from '../hooks/useCoverLetters';
import type { CoverLetter } from '../services/api/coverLetters';

/**
 * US-4.4's reachability guard (WIC-1530).
 *
 * The outreach composer shipped complete in UC-4 (PR #12) and stayed unreachable for
 * its entire life: `/outreach/new` was routed, but nothing in the app linked to it, so
 * the only way in was to type the URL. `route-integrity.test.ts` could not catch that —
 * it asserts link -> route, and an orphan route produces no link site to inspect.
 *
 * These tests pin the converse for this one route, end to end: the entry point exists,
 * it is reachable by clicking, and the context it hands over is the context the API
 * actually requires. The general route -> link audit is owned by a separate card.
 */

vi.mock('../hooks/useCoverLetters');

const COVER_LETTER: CoverLetter = {
  id: 'cl_01HZX',
  title: 'Senior Full Stack Engineer — TechCorp',
  content: 'Dear Hiring Manager, ...',
  targetCompany: 'TechCorp Inc.',
  targetRole: 'Senior Full Stack Engineer',
  tone: 'professional',
  lengthVariant: 'standard',
  emphasis: 'balanced',
  selectedStarEntryIds: [],
  status: 'finalized',
  version: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

/** The composer's success shape — enough for it to render its post-generation state. */
const GENERATED = {
  platform: 'linkedin' as const,
  body: 'Hi Jane — I just applied for the Senior Full Stack Engineer role...',
  subject: undefined,
  characterCount: 64,
  generatedAt: '2026-01-01T00:00:00.000Z',
};

function mockHooks() {
  const mutateAsync = vi.fn().mockResolvedValue(GENERATED);

  vi.mocked(useCoverLetter).mockReturnValue({
    data: COVER_LETTER,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useCoverLetter>);

  vi.mocked(useDeleteCoverLetter).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteCoverLetter>);

  vi.mocked(useExportCoverLetter).mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useExportCoverLetter>);

  vi.mocked(useGenerateOutreach).mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useGenerateOutreach>);

  return { mutateAsync };
}

/** Both real pages under one router, so a click actually navigates between them. */
function renderApp() {
  return render(
    <MemoryRouter initialEntries={[`/cover-letters/${COVER_LETTER.id}`]}>
      <Routes>
        <Route path="/cover-letters/:id" element={<CoverLetterDetail />} />
        <Route path="/outreach/new" element={<OutreachNew />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('outreach entry point', () => {
  // AC-1 — reachable from the product UI, without typing a URL.
  it('offers an outreach link on the cover letter it was generated from', () => {
    mockHooks();
    renderApp();

    const link = screen.getByRole('link', { name: /outreach/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/outreach/new'));
  });

  // AC-2 — the handover carries a content source plus the two fields the composer
  // needs to enable its Generate button.
  it('hands over the cover letter id and its job context', () => {
    mockHooks();
    renderApp();

    const href = screen.getByRole('link', { name: /outreach/i }).getAttribute('href') ?? '';
    const params = new URLSearchParams(href.split('?')[1] ?? '');

    expect(params.get('coverLetterId')).toBe(COVER_LETTER.id);
    expect(params.get('company')).toBe(COVER_LETTER.targetCompany);
    expect(params.get('jobTitle')).toBe(COVER_LETTER.targetRole);
  });

  /**
   * The load-bearing test. `generateOutreach` rejects with `JOB_CONTEXT_REQUIRED`
   * unless one of `coverLetterId` / `jobFitAnalysisId` / `selectedStarEntryIds`
   * reaches it. Before this fix the page read neither `coverLetterId` from the query
   * string nor passed one to the composer, so *any* entry point built the way the
   * ticket described would have 400'd on the first click of Generate.
   */
  it('reaches a composer that sends a valid content source', async () => {
    const user = userEvent.setup();
    const { mutateAsync } = mockHooks();
    renderApp();

    await user.click(screen.getByRole('link', { name: /outreach/i }));

    // Arrived on the composer, with the job context already filled in from the query
    // string — so Generate is enabled rather than disabled on an empty Company/Role.
    const generate = await screen.findByRole('button', { name: /generate message/i });
    expect(generate).toBeEnabled();

    await user.click(generate);

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        coverLetterId: COVER_LETTER.id,
        targetCompany: COVER_LETTER.targetCompany,
        targetRole: COVER_LETTER.targetRole,
      })
    );
  });
});

/**
 * AC-3 — the link must be visible to `route-integrity.test.ts`, not just to a user.
 * That audit reads source text, so a link built in a way its patterns cannot see
 * (`to={someVariable}`) would satisfy AC-1 and still leave the route looking orphaned.
 *
 * Pattern below is copied from `LINK_PATTERNS[1]` in `src/test/route-integrity.test.ts`,
 * which is the source of record. It is the JSX-expression form, which is what this
 * entry point uses because it interpolates the query string.
 */
const JSX_EXPRESSION_LINK = /\b(?:to|href)=\{\s*['"`](\/[^'"`]*)['"`]\s*\}/g;

function linkTargets(source: string): string[] {
  return [...source.matchAll(JSX_EXPRESSION_LINK)].map((m) => m[1].split('?')[0]);
}

describe('outreach entry point is statically detectable', () => {
  it('exposes /outreach/new to the route-integrity link patterns', () => {
    expect(linkTargets(coverLetterDetailSource)).toContain('/outreach/new');
  });

  /**
   * A control the fix cannot expire: strip the `to={...}` off the outreach link and
   * the same extractor must stop finding it. Without this, a pattern that silently
   * stopped matching — or one that matched something else entirely — would leave the
   * assertion above passing for the wrong reason.
   */
  it('stops finding it when the link target is removed', () => {
    const withoutLink = coverLetterDetailSource.replace(
      /to=\{`\/outreach\/new\?\$\{outreachParams\.toString\(\)\}`\}/,
      'to={outreachHref}'
    );

    expect(withoutLink).not.toBe(coverLetterDetailSource); // the replace actually fired
    expect(linkTargets(withoutLink)).not.toContain('/outreach/new');
  });
});
