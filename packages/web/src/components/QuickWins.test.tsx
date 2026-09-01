import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
  samples: Partial<DashboardAttention['samples']> = {}
): DashboardAttention {
  return {
    staleThresholdDays: 7,
    savedThresholdDays: 3,
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
