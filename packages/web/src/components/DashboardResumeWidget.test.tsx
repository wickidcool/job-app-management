import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { DashboardResumeWidget } from './DashboardResumeWidget';

/**
 * WIC-2236 — the two component-level obligations `Dashboard.unsettled.test.tsx` cannot
 * reach from the page.
 *
 * That file is the primary suite for this widget, and deliberately so: what regresses in
 * practice is the *wiring*, and a component test that hands the props in directly stays
 * green when the page stops passing them. See its header for the full argument.
 *
 * But the guards here are a conjunction, and one arm of each is unreachable from
 * `Dashboard` — the page computes `loading = dashboardPending || resumesPending` and reads
 * `isError`, so every state in which the counts are undefined *also* sets `loading` or
 * `error`. No page-level assertion can therefore kill a mutant that drops `!measured` from
 * the loading guard. This is the same hole WIC-2229's mutation matrix found in
 * `DashboardStats` (its M10 survived every page-level test for exactly this reason), so
 * these are its executioners and not a second copy of the page suite.
 */

const NO_RESUMES_CLAIM = /No resumes yet/i;
const STALE_NOTE = /most recent successful load/i;

function renderWidget(props: Parameters<typeof DashboardResumeWidget>[0]) {
  render(
    <MemoryRouter>
      <DashboardResumeWidget {...props} />
    </MemoryRouter>
  );
}

describe('DashboardResumeWidget — a count it was never given (WIC-2236)', () => {
  it('CONTROL: given counts and no flags, it states them', () => {
    renderWidget({ masterResumeCount: 2, exportCount: 5 });

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.queryByText(NO_RESUMES_CLAIM)).not.toBeInTheDocument();
  });

  it('CONTROL: a settled zero is still allowed to say the user has none', () => {
    // The state the widget is ENTITLED to call empty. Without this, everything below is
    // also satisfied by a widget that had simply lost its empty branch.
    renderWidget({ masterResumeCount: 0, exportCount: 0 });

    expect(screen.getByText(NO_RESUMES_CLAIM)).toBeInTheDocument();
  });

  it('makes no claim when the counts are absent and no flag is set', () => {
    // Unreachable from `Dashboard`, which is the point: this kills a mutant that drops
    // `!measured` from the loading guard, leaving `undefined > 0` to fall through to the
    // empty branch and restate the WIC-2227 false claim.
    renderWidget({});

    expect(screen.queryByText(NO_RESUMES_CLAIM)).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load your resumes/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Your Resumes/i })).toBeInTheDocument();
  });

  it('a failed request with NO counts still discloses the failure rather than skeletoning', () => {
    // The other arm: a mutant that drops `&& !measured` from the *error* guard is killed by
    // the page suite, but one that drops the whole error guard leaves a failed query
    // animating a skeleton forever — the WIC-2227 reason `error` exists at all.
    renderWidget({ error: true });

    expect(screen.getByText(/Couldn’t load your resumes/i)).toBeInTheDocument();
    expect(screen.queryByText(NO_RESUMES_CLAIM)).not.toBeInTheDocument();
  });

  it('discloses staleness on a cached EMPTY list too, not only on cached counts', () => {
    // The page suite pins the non-empty branch. A cached empty list is as much a dated
    // measurement as a cached non-empty one, and "No resumes yet" is the stronger claim of
    // the two — so it is the branch where the disclosure matters most.
    renderWidget({ masterResumeCount: 0, exportCount: 0, error: true });

    expect(screen.getByText(NO_RESUMES_CLAIM)).toBeInTheDocument();
    expect(screen.getByText(STALE_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t load your resumes/i)).not.toBeInTheDocument();
  });

  it('loading wins over a measurement, so a refresh is not reported as stale mid-flight', () => {
    renderWidget({ masterResumeCount: 2, exportCount: 5, loading: true });

    expect(screen.queryByText('2')).not.toBeInTheDocument();
    expect(screen.queryByText(STALE_NOTE)).not.toBeInTheDocument();
  });
});
