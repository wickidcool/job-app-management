import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AttentionCard } from './AttentionCard';
import { QuickWins } from './QuickWins';
import type { AttentionApplication, DashboardAttention } from '../services/api/types';

/**
 * WIC-1478 / AC-N1a: the "N actions" badge and the "View N more" link are counts
 * over the whole account. The rendered rows are a bounded sample; the numbers
 * beside them are not derived from that sample.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function app(id: string, daysAgo: number, status: AttentionApplication['status'] = 'applied') {
  const stamp = new Date(Date.now() - daysAgo * DAY_MS).toISOString();
  return {
    id,
    jobTitle: `Engineer ${id}`,
    company: `Company ${id}`,
    status,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function attention(
  counts: Partial<DashboardAttention['counts']>,
  samples: Partial<DashboardAttention['samples']> = {},
  thresholds: Partial<Pick<DashboardAttention, 'staleThresholdDays' | 'savedThresholdDays'>> = {}
): DashboardAttention {
  return {
    staleThresholdDays: thresholds.staleThresholdDays ?? 7,
    savedThresholdDays: thresholds.savedThresholdDays ?? 3,
    counts: {
      interviewing: 0,
      stale: 0,
      staleActive: 0,
      missingJobDescription: 0,
      staleSaved: 0,
      ...counts,
    },
    samples: {
      interviewing: [],
      staleActive: [],
      missingJobDescription: [],
      staleSaved: [],
      ...samples,
    },
  };
}

function renderWins(value?: DashboardAttention) {
  return render(
    <MemoryRouter>
      <QuickWins attention={value} />
    </MemoryRouter>
  );
}

describe('QuickWins (WIC-1478)', () => {
  it('counts every actionable application, not just the sampled rows', () => {
    renderWins(
      attention(
        { staleActive: 40, missingJobDescription: 7 },
        { staleActive: [app('a', 30), app('b', 25)], missingJobDescription: [app('c', 1)] }
      )
    );

    // 40 + 7 actionable; 3 rows sampled, 3 rendered, 44 hidden.
    expect(screen.getByText('47 actions')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View 44 more actions/ })).toBeInTheDocument();
  });

  it('renders no "more" link when the samples already cover everything', () => {
    renderWins(attention({ staleActive: 2 }, { staleActive: [app('a', 30), app('b', 20)] }));

    expect(screen.getByText('2 actions')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /more action/ })).not.toBeInTheDocument();
  });

  it('shows the days-since-update computed from the sampled row', () => {
    renderWins(attention({ staleActive: 1 }, { staleActive: [app('a', 30)] }));

    expect(screen.getByText('Company a - No update for 30 days')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send Follow-up' })).toHaveAttribute(
      'href',
      '/applications/a'
    );
  });

  it('never renders more than the visible window even with many samples', () => {
    renderWins(
      attention(
        { interviewing: 12, staleActive: 9 },
        {
          interviewing: [
            app('i1', 0, 'interview'),
            app('i2', 0, 'interview'),
            app('i3', 0, 'interview'),
            app('i4', 0, 'interview'),
            app('i5', 0, 'interview'),
          ],
          staleActive: [app('s1', 30), app('s2', 29)],
        }
      )
    );

    expect(screen.getAllByText('Prepare for Interview')).toHaveLength(5);
    expect(screen.queryByText('Follow Up Needed')).not.toBeInTheDocument();
    expect(screen.getByText('21 actions')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View 16 more actions/ })).toBeInTheDocument();
  });

  it('says "all caught up" only when the aggregates say there is nothing to do', () => {
    renderWins(attention({}));

    expect(screen.getByText('All caught up!')).toBeInTheDocument();
  });

  it('makes no claim while the aggregates are unavailable', () => {
    renderWins(undefined);

    expect(screen.queryByText('All caught up!')).not.toBeInTheDocument();
    expect(screen.getByText('Checking your applications…')).toBeInTheDocument();
  });
});

/**
 * WIC-1575: the server selects these rows with `timestamp < now - thresholdDays`,
 * i.e. a *fractional* age strictly greater than the threshold, while
 * `differenceInDays` floors. So a row the server picked at 7.5 days floors to 7 —
 * a number the ">7 days" bucket on `AttentionCard` excludes. The rendered row may
 * never state a count the bucket that selected it rules out.
 *
 * Ages here are deliberately fractional: an integer age would floor to itself and
 * could not tell a flooring bug from a correct one.
 */
describe('QuickWins row age vs the bucket that selected the row (WIC-1575)', () => {
  function renderStale(daysAgo: number, staleThresholdDays = 7) {
    return renderWins(
      attention(
        { staleActive: 1 },
        { staleActive: [app('a', daysAgo)] },
        { staleThresholdDays }
      )
    );
  }

  function renderSaved(daysAgo: number, savedThresholdDays = 3) {
    return renderWins(
      attention(
        { staleSaved: 1 },
        { staleSaved: [app('a', daysAgo, 'saved')] },
        { savedThresholdDays }
      )
    );
  }

  it.each([[7.1], [7.5], [7.9]])(
    'states the bound rather than the floored count for a %s-day stale row',
    (daysAgo) => {
      renderStale(daysAgo);

      expect(screen.getByText('Company a - No update in over 7 days')).toBeInTheDocument();
      // The exact copy the flooring bug produced, and the reason this card exists.
      expect(screen.queryByText('Company a - No update for 7 days')).not.toBeInTheDocument();
    }
  );

  it.each([
    [8.4, 8],
    [12.6, 12],
    [31.2, 31],
  ])('keeps the exact count for a %s-day stale row, which clears the bound', (daysAgo, shown) => {
    renderStale(daysAgo);

    expect(screen.getByText(`Company a - No update for ${shown} days`)).toBeInTheDocument();
    expect(screen.queryByText(/No update in over/)).not.toBeInTheDocument();
  });

  it('reads the stale bound off the wire rather than a constant in the component', () => {
    // Floors to 14, which clears a hardcoded 7 but not the threshold actually sent.
    renderStale(14.5, 14);

    expect(screen.getByText('Company a - No update in over 14 days')).toBeInTheDocument();
    expect(screen.queryByText('Company a - No update for 14 days')).not.toBeInTheDocument();
  });

  it.each([[3.2], [3.8]])(
    'states the bound rather than the floored count for a %s-day saved row',
    (daysAgo) => {
      renderSaved(daysAgo);

      expect(screen.getByText('Company a - Saved over 3 days ago')).toBeInTheDocument();
      expect(screen.queryByText('Company a - Saved 3 days ago')).not.toBeInTheDocument();
    }
  );

  it.each([
    [4.5, 4],
    [9.1, 9],
  ])('keeps the exact count for a %s-day saved row, which clears the bound', (daysAgo, shown) => {
    renderSaved(daysAgo);

    expect(screen.getByText(`Company a - Saved ${shown} days ago`)).toBeInTheDocument();
    expect(screen.queryByText(/Saved over/)).not.toBeInTheDocument();
  });

  it('bounds the saved row against the saved threshold, not the stale one', () => {
    // Floors to 10, which clears the stale threshold (7) but not the saved one.
    renderSaved(10.4, 10);

    expect(screen.getByText('Company a - Saved over 10 days ago')).toBeInTheDocument();
    expect(screen.queryByText('Company a - Saved 10 days ago')).not.toBeInTheDocument();
  });

  it('states no exact age at all when the payload carries no threshold to bound it', () => {
    // Not reachable from the live API — both fields ship in the same payload —
    // but it pins that a missing bound degrades to the old copy rather than to
    // an invented threshold.
    const value = attention({ staleActive: 1 }, { staleActive: [app('a', 7.5)] });
    renderWins({ ...value, staleThresholdDays: undefined as unknown as number });

    expect(screen.getByText('Company a - No update for 7 days')).toBeInTheDocument();
  });

  it('agrees with the AttentionCard bucket rendered beside it', () => {
    const value = attention({ stale: 3, staleActive: 3 }, { staleActive: [app('a', 7.5)] });

    render(
      <MemoryRouter>
        <AttentionCard attention={value} />
        <QuickWins attention={value} />
      </MemoryRouter>
    );

    const bucket = screen.getByText(/need follow-up \(>\d+ days\)/).textContent ?? '';
    const bound = Number(/\(>(\d+) days\)/.exec(bucket)?.[1]);
    expect(bound).toBe(7);

    const row = screen.getByText(/Company a - No update/).textContent ?? '';
    const stated = Number(/(\d+) days/.exec(row)?.[1]);

    // A row selected into a strictly-greater-than-`bound` bucket must either
    // state a larger number, or decline to state an exact one. Stating `bound`
    // itself as an exact age is the contradiction.
    expect(stated > bound || row.includes(`No update in over ${bound} days`)).toBe(true);
  });
});
