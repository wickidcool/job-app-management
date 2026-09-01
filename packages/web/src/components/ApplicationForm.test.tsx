import * as Dialog from '@radix-ui/react-dialog';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationForm } from './ApplicationForm';

/**
 * Regression cover for WIC-1854.
 *
 * The dialog was wired with `aria-describedby="application-form-description"` on
 * `Dialog.Content` and a matching `id` on `Dialog.Description`. That markup is *correct* —
 * real accessible name, real accessible description, attribute pointing at a node that
 * exists — and Radix warned on every mount anyway.
 *
 * `DescriptionWarning` (@radix-ui/react-dialog 1.1.15, `dist/index.mjs:302-311`) never reads
 * the `aria-describedby` attribute. It resolves Radix's own generated `context.descriptionId`
 * through `getElementById`, so an overridden id leaves that lookup empty and the warning
 * fires. `Dialog.Title` did not override its id here, which is why only the description
 * warning ever appeared.
 *
 * So this suite asserts on the console messages, not only on the accessible name: the
 * accessible name and description were already right before the fix, and a test that checked
 * only those would have passed against the defect. The positive control is what makes the
 * console assertions mean anything — without it they pass just as happily against a broken
 * spy or a Radix version that stopped warning.
 *
 * Sibling of `CommandPalette.test.tsx` (WIC-1851), which is where the trap was found and
 * which holds the same pair of guards; the rule is in `docs/design/ACCESSIBILITY.md` under
 * "Dialogs".
 */

/** Both Radix warnings, verbatim enough to match and loose enough to survive a reword. */
const RADIX_TITLE_WARNING = /requires a `DialogTitle`/;
const RADIX_DESCRIPTION_WARNING = /Missing `Description` or `aria-describedby=\{undefined\}`/;

function spyOnConsole() {
  // `restoreMocks: true` in vitest.config.ts puts these back after every test.
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  };
}

/**
 * The first argument of each recorded call, stringified.
 *
 * Structurally typed rather than `ReturnType<typeof vi.spyOn>`: that alias leaves the spy's
 * generics unresolved, so `mock.calls` degrades to an implicit `any` and `tsc -b` fails the
 * build under `noImplicitAny` while vitest itself runs perfectly happily.
 */
const calls = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0]));

function renderForm(mode: 'create' | 'edit' = 'create') {
  render(<ApplicationForm open onOpenChange={() => {}} onSubmit={async () => {}} mode={mode} />);
  return screen.getByRole('dialog');
}

describe('ApplicationForm — the dialog is described without stealing Radix’s id (WIC-1854)', () => {
  it.each([
    ['create', 'Add New Application', 'Form to add a new job application'],
    ['edit', 'Edit Application', 'Form to edit an existing job application'],
  ] as const)('names and describes the %s dialog exactly', (mode, name, description) => {
    const dialog = renderForm(mode);

    // Exact, not substring: this form's `Dialog.Content` wraps the whole field set, so a
    // substring matcher passes for a description that has picked up a label or an error.
    expect(dialog).toHaveAccessibleName(name);
    expect(dialog).toHaveAccessibleDescription(description);
  });

  it('keeps the description out of the visual design', () => {
    const dialog = renderForm();

    // The title is visible by design here (unlike CommandPalette's); only the description is
    // screen-reader-only. Guarding it means dropping the `sr-only` has to be deliberate.
    expect(within(dialog).getByText('Form to add a new job application')).toHaveClass('sr-only');
  });

  it('points `aria-describedby` at Radix’s own generated id, not a hand-written one', () => {
    const dialog = renderForm();

    // The mechanism, pinned directly: the id has to be the one Radix generated, because that
    // is the only one `getElementById(context.descriptionId)` will find. Re-adding
    // `id="application-form-description"` fails here as well as on the console guard below.
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy).not.toBe('application-form-description');
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'Form to add a new job application'
    );
  });

  it('emits neither Radix accessibility warning on mount', () => {
    const spies = spyOnConsole();

    renderForm();

    expect(calls(spies.error).filter((m) => RADIX_TITLE_WARNING.test(m))).toEqual([]);
    expect(calls(spies.warn).filter((m) => RADIX_DESCRIPTION_WARNING.test(m))).toEqual([]);
  });

  it('positive control: an unnamed Radix dialog does still emit both warnings', () => {
    // Without this the test above is not evidence of anything. It also pins the id-override
    // trap itself: give the `Dialog.Description` below an `id` and a matching
    // `aria-describedby` on `Dialog.Content` and the description warning keeps firing while
    // the markup reads as correct — which is exactly the defect this file covers.
    const spies = spyOnConsole();

    render(
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Content>unnamed</Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );

    expect(calls(spies.error).some((m) => RADIX_TITLE_WARNING.test(m))).toBe(true);
    expect(calls(spies.warn).some((m) => RADIX_DESCRIPTION_WARNING.test(m))).toBe(true);
  });
});
