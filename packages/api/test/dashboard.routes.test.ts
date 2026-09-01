import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';

vi.mock('../src/services/dashboard.service.js', () => ({
  getDashboardStats: vi.fn(),
}));

// Silence other service modules pulled in by app.ts
vi.mock('../src/services/application.service.js', () => ({
  createApplication: vi.fn(),
  getApplication: vi.fn(),
  listApplications: vi.fn(),
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
  updateApplicationStatus: vi.fn(),
}));

import * as dashboardService from '../src/services/dashboard.service.js';
import type { DashboardAttention } from '../src/types/index.js';

/**
 * WIC-1478. The Dashboard's attention/quick-win numbers are full-table
 * aggregates and are served from here. They used to be computed on the client
 * over `GET /api/applications`, which is paged and ordered by most-recently
 * updated — so a client-side "which of these are stale?" scan was structurally
 * blind to every row it was meant to surface.
 *
 * These tests pin the wire contract. Dropping a field here would put the client
 * straight back onto a page-scoped fallback.
 */

const attention: DashboardAttention = {
  staleThresholdDays: 7,
  savedThresholdDays: 3,
  counts: {
    interviewing: 6,
    stale: 40,
    staleActive: 31,
    missingJobDescription: 3,
    staleSaved: 9,
  },
  samples: {
    interviewing: [
      {
        id: 'app-1',
        jobTitle: 'Staff Engineer',
        company: 'Acme Corp',
        status: 'interview',
        createdAt: '2026-07-01T08:00:00.000Z',
        updatedAt: '2026-08-25T08:00:00.000Z',
      },
    ],
    staleActive: [
      {
        id: 'app-2',
        jobTitle: 'Backend Engineer',
        company: 'Globex',
        status: 'applied',
        createdAt: '2026-06-01T08:00:00.000Z',
        updatedAt: '2026-07-02T08:00:00.000Z',
      },
    ],
    missingJobDescription: [],
    staleSaved: [],
  },
};

const dashboardResponse = {
  stats: {
    total: 150,
    byStatus: {
      saved: 20,
      applied: 100,
      phone_screen: 4,
      interview: 2,
      offer: 1,
      rejected: 20,
      withdrawn: 3,
    },
    appliedThisWeek: 5,
    appliedThisMonth: 30,
    responseRate: 0.27,
  },
  recentActivity: [],
  attention,
};

describe('GET /api/dashboard', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns the attention aggregates alongside the stats', async () => {
    vi.mocked(dashboardService.getDashboardStats).mockResolvedValue(dashboardResponse);

    const res = await app.request('/api/dashboard', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.stats.total).toBe(150);
    expect(body.attention).toEqual(attention);
  });

  it('carries every attention count the dashboard cards render', async () => {
    vi.mocked(dashboardService.getDashboardStats).mockResolvedValue(dashboardResponse);

    const body = await (await app.request('/api/dashboard', { method: 'GET' })).json();

    // Named individually on purpose: a missing key here is a client surface
    // silently falling back to `?? 0` and under-reporting.
    expect(Object.keys(body.attention.counts).sort()).toEqual([
      'interviewing',
      'missingJobDescription',
      'stale',
      'staleActive',
      'staleSaved',
    ]);
    expect(Object.keys(body.attention.samples).sort()).toEqual([
      'interviewing',
      'missingJobDescription',
      'staleActive',
      'staleSaved',
    ]);
  });

  it('reports the stale threshold so the client never hard-codes it', async () => {
    vi.mocked(dashboardService.getDashboardStats).mockResolvedValue(dashboardResponse);

    const body = await (await app.request('/api/dashboard', { method: 'GET' })).json();

    expect(body.attention.staleThresholdDays).toBe(7);
    expect(body.attention.savedThresholdDays).toBe(3);
  });

  it('counts are independent of sample length', async () => {
    vi.mocked(dashboardService.getDashboardStats).mockResolvedValue(dashboardResponse);

    const body = await (await app.request('/api/dashboard', { method: 'GET' })).json();

    // 40 stale rows, 1 sampled. The whole point of the split: a bounded sample
    // must never bound the count beside it.
    expect(body.attention.counts.stale).toBe(40);
    expect(body.attention.samples.staleActive).toHaveLength(1);
  });
});
