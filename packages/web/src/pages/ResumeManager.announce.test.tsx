import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resumeService, type Resume } from '../services/api';
import { ResumeManager } from './ResumeManager';

/**
 * The delete announcement on `/resumes` — pinned in jsdom (WIC-2155).
 *
 * The other committed pin for this behaviour is `e2e/modal-focus.spec.ts:413-467`. This file
 * is the fast jsdom layer under it, and it is not redundant: measured on PR #423, removing
 * the live region from `ResumeManager` outright left the **vitest** suite fully green at
 * 837/837. The vitest suite on its own is blind to this, so without this file every guard on
 * the behaviour lives in Playwright.
 *
 * ⚠️ History, because it inverted mid-review (WIC-2164). This file was written at a moment
 * when the e2e pin did not execute at all: WIC-2131's deliberate loud-red gate failed the
 * `E2E Tests` job at `Assert isolation-test credentials are present` and skipped `Run E2E
 * tests` wholesale. WIC-2157 (PR #426) then moved that assertion into its own non-required
 * `e2e-isolation-coverage` job, and the e2e pin runs again — verified green on `main` at
 * `813af9c9`, run `34014906059`, as test 115. So this is a second layer, **not** a stand-in
 * for a suppressed one. What is still credential-blocked is the isolation/RLS suite
 * (WIC-2122, needs a human to mint `E2E_TEST_USER*`); that is a different gap, and nothing
 * in this file speaks to it.
 *
 * This file replicates that e2e test's *instrument*, not its text assertion, for the reason
 * given there: after the second delete the region's text names the right file either way,
 * because it is the **first** announcement still sitting there untouched. Only the sequence
 * of writes separates the two worlds, so count the writes.
 *
 * ## Deliberately implementation-agnostic
 *
 * Two mechanisms in the page independently produce the second write, and either alone is
 * sufficient (settled on PR #423, consistent with the PR #326 / WIC-1918 ruling — that is
 * redundancy in the production code, not a weak test):
 *
 *   1. `handleDeleteClick` clears the region as the dialog opens, so the next announcement
 *      is a real change rather than a re-set of the same string;
 *   2. `useAnnouncer`'s `announce` alternates a zero-width `REPEAT_MARKER`, so consecutive
 *      identical outcomes still differ as strings.
 *
 * `main` has (1) only; PR #423 migrates the page onto `<Announcer>`/`useAnnouncer` and has
 * both. This test asserts the *user-visible* contract both serve — two deletes produce two
 * announcements — and queries the region the way the e2e test does, `body >
 * [aria-live="polite"]`, which matches the hand-rolled region and `<Announcer>`'s portal
 * alike. It therefore passes on either side of that migration and pins the outcome across
 * it, rather than pinning whichever mechanism happens to be in the file today.
 *
 * ## Not asserted here, on purpose
 *
 * The e2e test also checks the region is outside `#root` and wraps nothing focusable. Both
 * are **vacuous in jsdom**: Testing Library renders into a bare `<div>` appended to
 * `document.body` and there is no `#root` at all, so `closest('#root')` is null however the
 * region is mounted. Those two belong to the e2e test and are left there.
 */

/** Same filename, distinct ids — the whole point. Uploads dedupe on contentHash, not
 *  fileName (`resume.service.ts`), so two resumes called `resume.pdf` are ordinary. A
 *  fixture with distinct names is structurally blind to this defect: the second
 *  announcement would differ as a string and mutate the region no matter what the page
 *  does. */
const SAME_NAME_RESUMES: Resume[] = [
  {
    id: 'resume-1',
    fileName: 'resume.pdf',
    fileSize: 148_000,
    mimeType: 'application/pdf',
    uploadedAt: new Date('2026-08-30T00:00:00Z'),
    version: 1,
  },
  {
    id: 'resume-2',
    fileName: 'resume.pdf',
    fileSize: 152_000,
    mimeType: 'application/pdf',
    uploadedAt: new Date('2026-08-31T00:00:00Z'),
    version: 2,
  },
];

const ANNOUNCEMENT = /resume\.pdf.*deleted/i;

/**
 * Serve a list that actually shrinks, so the page re-renders exactly as it does in the
 * browser: `useDeleteResume` invalidates `resumeKeys.all` on success, react-query refetches
 * through `getAll`, and the deleted row leaves the DOM.
 */
function mockShrinkingResumeList(initial: Resume[]) {
  const remaining = [...initial];
  vi.spyOn(resumeService, 'getAll').mockImplementation(async () => [...remaining]);
  vi.spyOn(resumeService, 'delete').mockImplementation(async (id: string) => {
    const at = remaining.findIndex((resume) => resume.id === id);
    if (at === -1) throw new Error(`fixture does not hold a resume ${id}`);
    remaining.splice(at, 1);
  });
  return remaining;
}

function renderResumeManager() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/resumes']}>
        <ResumeManager />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Record every write to the live region, the way the e2e test does.
 *
 * ⚠️ `MutationObserver` records are delivered as **microtasks**, so they are not visible
 * here until something yields. This harness gets that for free: every action below goes
 * through `await user.click(...)`, and user-event's default inter-event delay crosses a
 * real task boundary, so each action's records land before the next line runs. Measured —
 * stripping an explicit flush after each action changes nothing, green or red.
 *
 * A harness that drove the page with bare `act()` instead would need an explicit
 * `await new Promise((r) => setTimeout(r, 0))` per action. **A uniform zero across every
 * case is the tell** that the flush, not the app, is what is wrong.
 */
function watchAnnouncer() {
  const announcer = document.querySelector('body > [aria-live="polite"]');
  if (!announcer) throw new Error('live region not found — the fixture is wrong, not the app');

  const writes: string[] = [];
  const observer = new MutationObserver(() => {
    // Record the region's settled text once per delivery, and only when it differs from the
    // last one. One React commit can emit several records — a text node replaced rather
    // than mutated arrives as a removal plus an addition — and all of them read the same
    // settled text, so counting records instead of transitions would count DOM bookkeeping
    // rather than announcements.
    //
    // Two identical announcements in a row cannot be hidden by this dedupe: React bails on
    // `Object.is` and emits no record at all, which is precisely the defect under test.
    // The one thing it would miss is two *different* writes batched into a single delivery,
    // which cannot happen here — the clear and the announce are separate commits from
    // separate user actions, and the test yields between them. If they ever were batched
    // this under-counts and the test goes red, so the failure direction is the safe one.
    const text = announcer.textContent ?? '';
    if (writes[writes.length - 1] !== text) writes.push(text);
  });
  observer.observe(announcer, { childList: true, characterData: true, subtree: true });

  return {
    observer,
    /** Every recorded write, in order. */
    writes,
    /** Just the ones assistive tech would read out as this delete's outcome. */
    announcements: () => writes.filter((text) => ANNOUNCEMENT.test(text)),
    text: () => announcer.textContent ?? '',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResumeManager delete announcement', () => {
  it('announces every delete, including a second resume with an identical name', async () => {
    mockShrinkingResumeList(SAME_NAME_RESUMES);
    // Radix marks the body `pointer-events: none` while the modal is open, which
    // user-event reads as "this control is not clickable". The dialog's buttons are
    // genuinely operable; only the guard is confused.
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    renderResumeManager();
    await screen.findByRole('region', { name: 'Resumes' });

    /** The per-row triggers, scoped to the list region. The dialog's own confirm button is
     *  portalled outside that region, so this never picks it up — and the row buttons'
     *  accessible name is `🗑️ Delete` (text content wins over their `title`), which is why
     *  scoping beats matching on the name. */
    const rowDeleteButtons = () =>
      within(screen.getByRole('region', { name: 'Resumes' })).getAllByRole('button', {
        name: /delete/i,
      });

    await vi.waitFor(() => expect(rowDeleteButtons()).toHaveLength(2));

    const announcer = watchAnnouncer();

    /** Delete the top row, driving the page's real handlers in their real order:
     *  `handleDeleteClick` on open, then `handleConfirmDelete` on confirm — separate
     *  commits from separate user actions, each flushed on its own. */
    const deleteFirstRow = async () => {
      await user.click(rowDeleteButtons()[0]);

      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    };

    await deleteFirstRow();
    await vi.waitFor(() => expect(rowDeleteButtons()).toHaveLength(1));
    expect(announcer.announcements()).toHaveLength(1);

    await deleteFirstRow();
    await screen.findByRole('button', { name: 'Upload Your First Resume' });

    // Two deletes, two announcements. Without a mechanism that makes the second write a
    // real DOM change this is 1: the second `setState` assigns a string equal to the first,
    // React bails on `Object.is`, no text node mutates, and a screen-reader user is told
    // nothing at all about a second irreversible action while the row visibly disappears.
    expect(
      announcer.announcements(),
      `live-region writes in order: ${JSON.stringify(announcer.writes)}`
    ).toHaveLength(2);

    // ...and the announcement is what is left standing, not the blank the clear passes
    // through. Guards the half-fix that clears the region but never re-announces.
    expect(announcer.text()).toMatch(ANNOUNCEMENT);

    announcer.observer.disconnect();
  });
});
