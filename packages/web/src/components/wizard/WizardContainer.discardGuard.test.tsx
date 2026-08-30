import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

import { WizardContainer } from './WizardContainer';
import wizardContainerSource from './WizardContainer.tsx?raw';
import dialogueCaptureSource from '../../pages/DialogueCapture.tsx?raw';

/**
 * WIC-1765 — confirm before discarding the dialogue wizard.
 *
 * The ruling (docs/design/DIALOGUE_CAPTURE_WIZARD.md § "Ruling: draft persistence
 * is dropped") drops draft persistence outright, so the wizard's state now lives
 * only in React state. Closing it is therefore total, silent loss, and the three
 * discard paths below must each confirm first.
 *
 * ## The one thing these tests exist to pin
 *
 * Dirtiness is measured against the **seeded** initial state. `data` is seeded
 * with `{accomplishments: [], jobFit: [], techStack: []}`, so the obvious
 * predicate `Object.keys(data).length > 0` is *true before the user types
 * anything*. That is not a hypothetical: it is the exact bug that made the old
 * 30-second autosave fire unconditionally on an untouched wizard (WIC-1621).
 *
 * The tests that would catch a regression to that predicate are the
 * "untouched wizard" ones — they are the load-bearing controls here, not the
 * happy-path ones. Under `Object.keys(data).length` they fail; under a correct
 * predicate they pass. Every "does prompt" test below would pass under the bug,
 * so on their own they prove nothing about it.
 */

/** Renders the wizard at its real route, with a nav link that lives OUTSIDE the
 *  wizard overlay — the way TopNavigation does in App.tsx (nav is a sibling of
 *  <main>, and the wizard renders no focus trap, so it is genuinely reachable).
 *
 *  `<Link>`, not a bare `<a href>`, and that distinction is load-bearing:
 *  TopNavigation uses `<Link>` (TopNavigation.tsx:1), and jsdom does not follow
 *  bare anchors at all. Against a bare anchor the "did not navigate" assertions
 *  below would pass no matter what the guard did — they would be measuring
 *  jsdom, not the code. */
function renderWizard(onComplete = vi.fn(), onCancel = vi.fn()) {
  const view = render(
    <MemoryRouter initialEntries={['/projects/new/dialogue']}>
      <Link to="/projects">Projects</Link>
      <Routes>
        <Route
          path="/projects/new/dialogue"
          element={<WizardContainer variant="create" onComplete={onComplete} onCancel={onCancel} />}
        />
        <Route path="/projects" element={<h1>Projects landing</h1>} />
      </Routes>
    </MemoryRouter>
  );
  return { ...view, onComplete, onCancel };
}

const confirmTitle = () => screen.queryByText('Discard this project?');

async function typeCompany(user: ReturnType<typeof userEvent.setup>, value = 'Acme Corporation') {
  await user.type(screen.getByPlaceholderText('e.g., Acme Corporation'), value);
}

/** The forward control carries an `aria-label` ("Go to step 3" / "Go to preview"),
 *  which wins over its "Next →" text, so that is what it must be queried by. */
async function goForward(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name }));
}

/** Walks steps 1-3, leaving the wizard on step 4 (the accomplishments form). */
async function walkToAccomplishments(user: ReturnType<typeof userEvent.setup>) {
  await typeCompany(user);
  await goForward(user, 'Go to step 2');
  await user.type(screen.getByLabelText('Role or Title'), 'Senior Engineer');
  await user.type(screen.getByLabelText('Time Period'), 'Jan 2023 - Present');
  await goForward(user, 'Go to step 3');
  await user.type(screen.getByPlaceholderText(/Enter the industry name/), 'FinTech');
  await goForward(user, 'Go to step 4');
}

describe('WizardContainer — confirm on discard (WIC-1765)', () => {
  describe('with unsaved answers, every discard path confirms first (AC-1)', () => {
    it('confirms on Escape', async () => {
      const user = userEvent.setup();
      renderWizard();
      await typeCompany(user);

      await user.keyboard('{Escape}');

      expect(confirmTitle()).toBeInTheDocument();
    });

    it('confirms on the header close button', async () => {
      const user = userEvent.setup();
      const { onCancel } = renderWizard();
      await typeCompany(user);

      await user.click(screen.getByRole('button', { name: 'Close wizard' }));

      expect(confirmTitle()).toBeInTheDocument();
      // The confirm must gate the close, not follow it.
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('confirms on in-app navigation away, and does not navigate', async () => {
      const user = userEvent.setup();
      renderWizard();
      await typeCompany(user);

      await user.click(screen.getByRole('link', { name: 'Projects' }));

      expect(confirmTitle()).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Projects landing' })).not.toBeInTheDocument();
    });

    it('carries the copy the ruling specifies, including the "not saved anywhere" clause', async () => {
      const user = userEvent.setup();
      renderWizard();
      await typeCompany(user);
      await user.keyboard('{Escape}');

      // Load-bearing per the ruling: users who saw a "Save Draft" button for
      // months will reasonably assume a draft exists somewhere.
      expect(
        screen.getByText(
          'You have unsaved answers. Closing now discards them — they are not saved anywhere.'
        )
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
    });
  });

  describe('"Keep editing" returns the user to their work intact (AC-1)', () => {
    it('dismisses the confirm and leaves the typed answer in place', async () => {
      const user = userEvent.setup();
      const { onCancel } = renderWizard();
      await typeCompany(user);

      await user.click(screen.getByRole('button', { name: 'Close wizard' }));
      await user.click(screen.getByRole('button', { name: 'Keep editing' }));

      expect(confirmTitle()).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g., Acme Corporation')).toHaveValue('Acme Corporation');
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: 'Projects landing' })).not.toBeInTheDocument();
    });

    it('treats Escape while the confirm is open as "keep editing", not a second discard', async () => {
      const user = userEvent.setup();
      const { onCancel } = renderWizard();
      await typeCompany(user);
      await user.keyboard('{Escape}');

      await user.keyboard('{Escape}');

      expect(confirmTitle()).not.toBeInTheDocument();
      expect(onCancel).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('e.g., Acme Corporation')).toHaveValue('Acme Corporation');
    });
  });

  describe('"Discard" proceeds, and nothing is persisted (AC-2)', () => {
    it('cancels the wizard when the discard came from the close button', async () => {
      const user = userEvent.setup();
      const { onCancel } = renderWizard();
      await typeCompany(user);

      await user.click(screen.getByRole('button', { name: 'Close wizard' }));
      await user.click(screen.getByRole('button', { name: 'Discard' }));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(confirmTitle()).not.toBeInTheDocument();
    });

    it('completes the original navigation when the discard came from a link', async () => {
      const user = userEvent.setup();
      renderWizard();
      await typeCompany(user);

      await user.click(screen.getByRole('link', { name: 'Projects' }));
      await user.click(screen.getByRole('button', { name: 'Discard' }));

      // The user asked to go to /projects, so that is where they must land —
      // not merely "the wizard closed".
      expect(await screen.findByRole('heading', { name: 'Projects landing' })).toBeInTheDocument();
    });

    it('writes nothing to localStorage across a full type-then-discard cycle', async () => {
      const user = userEvent.setup();
      const setItem = vi.spyOn(Storage.prototype, 'setItem');
      renderWizard();
      await typeCompany(user);

      await user.click(screen.getByRole('button', { name: 'Close wizard' }));
      await user.click(screen.getByRole('button', { name: 'Discard' }));

      expect(setItem).not.toHaveBeenCalled();
      expect(localStorage.length).toBe(0);
    });
  });

  describe('an untouched wizard never prompts (AC-3)', () => {
    // These are the controls that discriminate a correct dirty-check from
    // `Object.keys(data).length > 0`. See the file header.
    it('closes straight away on Escape', async () => {
      const user = userEvent.setup();
      const { onCancel } = renderWizard();

      await user.keyboard('{Escape}');

      expect(confirmTitle()).not.toBeInTheDocument();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('closes straight away on the header close button', async () => {
      const user = userEvent.setup();
      const { onCancel } = renderWizard();

      await user.click(screen.getByRole('button', { name: 'Close wizard' }));

      expect(confirmTitle()).not.toBeInTheDocument();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('lets in-app navigation through untouched', async () => {
      const user = userEvent.setup();
      renderWizard();

      await user.click(screen.getByRole('link', { name: 'Projects' }));

      expect(confirmTitle()).not.toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Projects landing' })).toBeInTheDocument();
    });

    it('keeps the user on the step they were on when they choose "Keep editing"', async () => {
      // Deliberately NOT sold as a test of the `currentSTAR` term in the dirty
      // check. By the time step 4 is reachable, `data.company`/`role`/`period`/
      // `industry` are all set, so `data` alone is already dirty and this
      // fixture cannot isolate `currentSTAR`. A clean step 4 is unreachable
      // through the UI: ProgressIndicator only permits BACKWARD jumps
      // (`isClickable = step < currentStep`) and steps 1-3 gate `canProceed`.
      //
      // What it does pin, and nothing above does, is that declining the discard
      // deep in the wizard returns the user to *their* step rather than
      // resetting them to step 1.
      const user = userEvent.setup();
      renderWizard();
      await walkToAccomplishments(user);

      await user.keyboard('{Escape}');
      expect(confirmTitle()).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Keep editing' }));

      expect(confirmTitle()).not.toBeInTheDocument();
      expect(
        screen.getByText('Tell me about your key accomplishments', { exact: false })
      ).toBeInTheDocument();
    });
  });

  describe('completing the wizard is not a discard (AC-4)', () => {
    it('does not prompt when the wizard finishes and navigates to the new file', async () => {
      const user = userEvent.setup();
      const { onComplete } = renderWizard();

      await walkToAccomplishments(user);

      // Step 4 — a STAR entry needs every field at 10+ chars before it can be saved.
      await user.type(
        screen.getByLabelText(/Describe this accomplishment in one sentence/),
        'Cut checkout latency in half'
      );
      await user.type(screen.getByLabelText(/^Situation:/), 'Checkout p95 sat above four seconds.');
      await user.type(screen.getByLabelText(/^Task:/), 'Bring p95 under one second.');
      await user.type(screen.getByLabelText(/^Action:/), 'Introduced a read-through cache.');
      await user.type(screen.getByLabelText(/^Result:/), 'p95 fell to 780ms within a week.');
      await user.click(screen.getByRole('button', { name: /Save This Accomplishment/ }));
      await goForward(user, 'Go to step 5');

      // Step 5 — the last step's forward control is labelled "Go to preview".
      await goForward(user, 'Go to preview');

      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      expect(confirmTitle()).not.toBeInTheDocument();
    });

    it('still guards if the create failed and left the wizard open with the answers', async () => {
      // `DialogueCapture.handleComplete` catches a failed create and only
      // `alert()`s, so the wizard stays mounted with everything still typed in
      // it and still saved nowhere. A "has completed" latch would disarm the
      // guard here — for exactly the user who most needs it. `onComplete` below
      // returns without unmounting, which is that failure shape.
      const user = userEvent.setup();
      renderWizard(vi.fn());
      await typeCompany(user);

      await user.click(screen.getByRole('link', { name: 'Projects' }));

      expect(confirmTitle()).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Projects landing' })).not.toBeInTheDocument();
    });
  });

  describe('no draft is written anywhere (AC-5)', () => {
    /**
     * The card's AC-5 asks that `git grep dialogue-wizard-draft` return zero
     * hits. It does not, and it must not: WIC-1495 deliberately KEEPS the
     * `dialogue-wizard-draft-` prefix registered in `appStorage.ts` so that
     * copies already sitting on users' disks are cleared on their next
     * sign-out. Deleting the name would strand that data permanently.
     *
     * The invariant that actually matters is therefore "no write path", which
     * is what these assert. Asserting the grep count instead would have forced
     * a fix that reintroduces the bug the previous card fixed.
     */
    it('the wizard writes no draft key', () => {
      expect(wizardContainerSource).not.toMatch(/setItem/);
      expect(wizardContainerSource).not.toMatch(/dialogue-wizard-draft/);
    });

    it('the wizard route writes no draft key', () => {
      expect(dialogueCaptureSource).not.toMatch(/setItem/);
      expect(dialogueCaptureSource).not.toMatch(/dialogue-wizard-draft/);
    });

    it('has no beforeunload handler, per the ruling', () => {
      // Explicitly ruled out: browsers substitute their own generic string, so
      // the copy above cannot survive, and it fires on tab close where the user
      // has no recourse.
      expect(wizardContainerSource).not.toMatch(/beforeunload/);
    });
  });
});
