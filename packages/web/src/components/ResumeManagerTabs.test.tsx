import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResumeManagerTabs } from './ResumeManagerTabs';

/**
 * Resume Manager tab active-state (WIC-1136).
 *
 * The tab bar renders on `/resumes`, `/resumes/exports`, `/resumes/upload` and
 * the parameterized `/resumes/:resumeId/exports`. The original `startsWith`
 * matcher lit no tab on the parameterized route — `/resumes/abc/exports` starts
 * with none of the three tab paths — so a user arriving from "View Exports" saw a
 * tab bar with nothing selected and a screen reader got no position in the set.
 *
 * The matcher is end-anchored (`matchPath`), so `/resumes` must stay exclusive to
 * Master Resumes rather than prefix-matching every sub-route, and exactly one tab
 * is current on every real route.
 */

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ResumeManagerTabs />
    </MemoryRouter>
  );
}

// The current tab is the one carrying aria-current="page"; AC1/AC2 pin which tab,
// AC3 pins that there is never more than one.
function currentTabName() {
  const current = document.querySelectorAll('[aria-current="page"]');
  expect(current).toHaveLength(1);
  return current[0].textContent;
}

describe('ResumeManagerTabs active state', () => {
  it('highlights Master Resumes only on /resumes (exact match, not a prefix)', () => {
    renderAt('/resumes');
    expect(currentTabName()).toBe('Master Resumes');
  });

  it('highlights Exports on /resumes/exports', () => {
    renderAt('/resumes/exports');
    expect(currentTabName()).toBe('Exports');
  });

  it('highlights Upload New on /resumes/upload', () => {
    renderAt('/resumes/upload');
    expect(currentTabName()).toBe('Upload New');
  });

  it('highlights Exports on the parameterized /resumes/:resumeId/exports (the bug)', () => {
    renderAt('/resumes/abc123/exports');
    expect(currentTabName()).toBe('Exports');
  });

  it('never highlights more than one tab', () => {
    for (const path of [
      '/resumes',
      '/resumes/exports',
      '/resumes/upload',
      '/resumes/abc123/exports',
    ]) {
      const { unmount } = renderAt(path);
      expect(document.querySelectorAll('[aria-current="page"]').length).toBeLessThanOrEqual(1);
      unmount();
    }
  });

  it('exposes all three tabs as links regardless of route', () => {
    renderAt('/resumes/abc123/exports');
    expect(screen.getByRole('link', { name: 'Master Resumes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Exports' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload New' })).toBeInTheDocument();
  });
});
