import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AttentionCard } from './AttentionCard';
import type { DashboardAttention } from '../services/api/types';

/**
 * WIC-1478 / AC-N1a: every count this card renders comes from the server's
 * full-table aggregates. The card has no application list to fall back on, by
 * construction — that is the fix.
 */

function attention(overrides: Partial<DashboardAttention['counts']> = {}): DashboardAttention {
  return {
    staleThresholdDays: 7,
    savedThresholdDays: 3,
    counts: {
      interviewing: 0,
      stale: 0,
      staleActive: 0,
      missingJobDescription: 0,
      staleSaved: 0,
      ...overrides,
    },
    samples: {
      interviewing: [],
      staleActive: [],
      missingJobDescription: [],
      staleSaved: [],
    },
  };
}

function renderCard(value?: DashboardAttention) {
  return render(
    <MemoryRouter>
      <AttentionCard attention={value} />
    </MemoryRouter>
  );
}

describe('AttentionCard (WIC-1478)', () => {
  it('renders the server stale count verbatim, however large', () => {
    renderCard(attention({ stale: 137 }));

    expect(screen.getByText(/^137 applications need follow-up \(>7 days\)/)).toBeInTheDocument();
  });

  it('uses the threshold the server reports rather than a hard-coded 7', () => {
    const value = attention({ stale: 4 });
    value.staleThresholdDays = 14;

    renderCard(value);

    expect(screen.getByText(/^4 applications need follow-up \(>14 days\)/)).toBeInTheDocument();
  });

  it('singularises a count of one', () => {
    renderCard(attention({ stale: 1, interviewing: 1 }));

    expect(screen.getByText(/^1 application needs? follow-up/)).toBeInTheDocument();
    expect(screen.getByText(/^1 interview in progress/)).toBeInTheDocument();
  });

  it('reports interviews in progress from the status counts', () => {
    renderCard(attention({ interviewing: 6 }));

    expect(screen.getByText(/^6 interviews in progress/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Prepare for Interviews' })).toBeInTheDocument();
  });

  it('shows the missing-description hint at the "5 or fewer" boundary', () => {
    renderCard(attention({ missingJobDescription: 5 }));

    expect(screen.getByText(/^5 applications missing job description/)).toBeInTheDocument();
  });

  it('keeps suppressing the missing-description hint above that boundary', () => {
    // Pre-existing product rule, deliberately preserved: past 5 this stops being
    // a quick fix and belongs on the applications list instead.
    renderCard(attention({ missingJobDescription: 6 }));

    expect(screen.queryByText(/missing job description/)).not.toBeInTheDocument();
  });

  it('says everything is up to date only when the aggregates say so', () => {
    renderCard(attention());

    expect(screen.getByText('All applications are up to date!')).toBeInTheDocument();
  });

  it('makes no claim at all while the aggregates are unavailable', () => {
    // The old component received `applications=[]` during loading and cheerfully
    // announced that everything was fine. An absent answer is not a clean bill
    // of health.
    renderCard(undefined);

    expect(screen.queryByText('All applications are up to date!')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Attention Required' })).toBeInTheDocument();
  });
});
