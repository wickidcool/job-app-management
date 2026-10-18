import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { JobFitAnalysis } from './JobFitAnalysis';
import { APIError } from '../services/api/apiClient';

/**
 * WIC-2655 — a Free user who hits the Pro gate on job-fit analysis sees the upgrade
 * affordance (UpgradePrompt), not the generic red "Analysis Failed" card.
 *
 * The component reads the mutation's `error` field (not the value handed to
 * `onError`) when it renders the error stage, so the mock supplies both: the 402
 * entitlement error as `error`, and an `onError` that drives the component into the
 * error stage. A `QueryClientProvider` is required because UpgradePrompt mounts
 * `useStartCheckout` (a react-query mutation).
 */
const mockApplication = { data: undefined as unknown, isLoading: false };
const mockMutation = {
  mutate: vi.fn(),
  isPending: false,
  error: null as unknown,
};

vi.mock('../hooks/useApplications', () => ({
  useApplication: () => mockApplication,
}));

vi.mock('../hooks/useJobFitAnalysis', () => ({
  useJobFitAnalysis: () => mockMutation,
}));

function renderJobFit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/job-fit-analysis']}>
        <JobFitAnalysis />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function submitAnalysis() {
  fireEvent.change(screen.getByLabelText('Job Description'), {
    target: { value: 'x'.repeat(200) },
  });
  fireEvent.click(screen.getByRole('button', { name: /analyze fit/i }));
  await waitFor(() => expect(mockMutation.mutate).toHaveBeenCalled());
}

beforeEach(() => {
  mockApplication.data = undefined;
  mockApplication.isLoading = false;
  mockMutation.isPending = false;
  mockMutation.error = null;
  mockMutation.mutate = vi.fn();
});

describe('/job-fit-analysis Pro-gate branch (WIC-2655)', () => {
  it('renders the upgrade prompt instead of the generic error on a 402 UPGRADE_REQUIRED', async () => {
    const err = new APIError(
      'UPGRADE_REQUIRED',
      'AI job-fit analysis is a Pro feature. Upgrade to continue.',
      402,
      { feature: 'ai_job_fit', requiredTier: 'pro' }
    );
    mockMutation.error = err;
    mockMutation.mutate = vi.fn((_request, { onError }) => onError(err));

    renderJobFit();
    await submitAnalysis();

    // The upgrade affordance is shown…
    expect(
      screen.getByText('AI job-fit analysis is a Pro feature. Upgrade to continue.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upgrade to pro/i })).toBeInTheDocument();
    // …and the generic failure card is not.
    expect(screen.queryByText('Analysis Failed')).not.toBeInTheDocument();
    // The route's h1 is still present (the frame owns it for every branch).
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Job Fit Analysis');
  });

  it('still shows the generic error card for a non-entitlement failure', async () => {
    const err = new APIError('JD_PARSE_FAILED', 'Could not parse.', 422);
    mockMutation.error = err;
    mockMutation.mutate = vi.fn((_request, { onError }) => onError(err));

    renderJobFit();
    await submitAnalysis();

    expect(screen.getByText('Analysis Failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upgrade to pro/i })).not.toBeInTheDocument();
  });
});
