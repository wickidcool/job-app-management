import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ResumeUpload } from './ResumeUpload';
import { tabUntilFocused } from '../test/reportsKeyboardNav';

/**
 * The resume drop zone can be operated from the keyboard (WIC-2077 slice 2).
 *
 * This one was NOT the `FilterPanel`/`StarEntryPicker` shape, where a real control already
 * existed and the wrapper handler was merely redundant. Here there was no control at all:
 * the `<input type="file">` is `className="hidden"`, the dropzone's `onClick` was the only
 * pointer path to the file picker, and the copy said "or click to browse" while there was
 * nothing to press. So there was **no keyboard path to uploading a resume** — WCAG 2.1.1,
 * a genuine defect rather than a lint artifact. `jsx-a11y` recorded it as
 * `click-events-have-key-events` + `no-noninteractive-element-interactions`.
 *
 * The fix adds a real "browse files" `<button>` inside the zone, wired to the same
 * `handleClick`, and drops the wrapper's `onClick`. The `<div>` keeps `role="region"`, its
 * `aria-label` and the drag handlers: it is still the drop target, just no longer the
 * control.
 *
 * ⚠️ Only `click-events-have-key-events` retires. `no-noninteractive-element-interactions`
 * stays, because `onDrop`/`onDragOver`/`onDragLeave` trip it on their own — measured,
 * against a scoping prediction that said they would not. See WIC-2078.
 */

/**
 * The hidden `<input type="file">` is what the button ultimately clicks, and jsdom does not
 * open a file picker. Spy on the input's own `click` so the assertion is about the wiring
 * that actually exists, rather than about a dialog no test host can show.
 */
function renderUpload() {
  const onUploadComplete = vi.fn();
  const onUploadError = vi.fn();
  const view = render(
    <ResumeUpload onUploadComplete={onUploadComplete} onUploadError={onUploadError} />
  );
  const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
  return { ...view, input, clickSpy, onUploadComplete, onUploadError };
}

const BROWSE = 'browse files';

describe('ResumeUpload keyboard navigation', () => {
  it('exposes a real control for choosing a file', () => {
    renderUpload();

    // Before the fix this query found nothing: the only "control" was a div with an onClick
    // and prose telling the user to click it.
    expect(screen.getByRole('button', { name: BROWSE })).toBeVisible();
  });

  it('reaches the browse control by Tab and activates it with Enter', async () => {
    const user = userEvent.setup();
    const { clickSpy } = renderUpload();

    const browse = screen.getByRole('button', { name: BROWSE });
    expect(await tabUntilFocused(user, browse)).toBeGreaterThan(0);

    await user.keyboard('{Enter}');
    expect(clickSpy).toHaveBeenCalled();
  });

  it('still opens the picker on click', async () => {
    const user = userEvent.setup();
    const { clickSpy } = renderUpload();

    await user.click(screen.getByRole('button', { name: BROWSE }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('does not open the picker from the inert zone body', async () => {
    const user = userEvent.setup();
    const { clickSpy } = renderUpload();

    // The instruction text sits inside the drop zone but outside the button. Before the fix
    // this click reached the wrapper's `onClick` and opened the picker; the wrapper is now
    // inert, which is a real change for pointer users and is why it is asserted.
    await user.click(screen.getByText('Drag & drop your resume here'));
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('keeps the drop zone as a named region', () => {
    renderUpload();

    // The region and its name are what the drag handlers hang off. Losing them while
    // "fixing" the lint finding would trade one defect for another.
    expect(screen.getByRole('region', { name: 'Resume upload area' })).toBeVisible();
  });
});
