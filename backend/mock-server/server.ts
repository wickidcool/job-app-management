/**
 * Local development mock server for Job Application Manager API.
 *
 * Implements the full API contract (API_CONTRACTS.md) using in-memory state.
 * No AWS credentials required — perfect for frontend development while
 * the real backend deployment is pending (WIC-27).
 *
 * Usage:
 *   cd backend && npm run start:mock
 *   # Server starts at http://localhost:3001
 *
 * Auth: Pass any Bearer token. The mock extracts the user ID from it,
 * or falls back to a fixed dev user "mock-user-001".
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const express = require('express') as typeof import('express');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cors = require('cors') as typeof import('cors');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ulid } = require('ulid') as typeof import('ulid');

import type { Request, Response, NextFunction } from 'express';

// ─── Types ────────────────────────────────────────────────────────────────────

type ApplicationStatus =
  | 'saved'
  | 'applied'
  | 'phone_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn';

interface Application {
  id: string;
  userId: string;
  jobTitle: string;
  company: string;
  url?: string;
  location?: string;
  salaryRange?: string;
  status: ApplicationStatus;
  coverLetterId?: string;
  resumeVersionId?: string;
  createdAt: string;
  updatedAt: string;
  appliedAt?: string;
  version: number;
}

interface StatusHistoryEntry {
  applicationId: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string;
  note?: string;
}

// ─── In-memory state ──────────────────────────────────────────────────────────

const applications = new Map<string, Application>();
const statusHistory = new Map<string, StatusHistoryEntry[]>();

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_STATUSES: ApplicationStatus[] = [
  'saved', 'applied', 'phone_screen', 'interview', 'offer', 'rejected', 'withdrawn',
];

const VALID_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  saved:        ['applied', 'withdrawn'],
  applied:      ['phone_screen', 'rejected', 'withdrawn'],
  phone_screen: ['interview', 'rejected', 'withdrawn'],
  interview:    ['offer', 'rejected', 'withdrawn'],
  offer:        [],
  rejected:     [],
  withdrawn:    [],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function appKey(userId: string, appId: string) {
  return `${userId}:${appId}`;
}

function historyKey(userId: string, appId: string) {
  return `${userId}:${appId}`;
}

function toApiShape(app: Application) {
  const { userId: _u, ...rest } = app;
  return rest;
}

function getUserId(req: Request): string {
  // Accept any Bearer token; parse sub from a real JWT if present,
  // otherwise use a fixed dev user so the mock works without a real Cognito setup.
  const auth = req.headers['authorization'] ?? '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      if (payload.sub) return payload.sub as string;
    } catch {
      // Not a JWT — use the raw token as user ID for easy testing
      if (token.length > 0 && token !== 'undefined') return token;
    }
  }
  return 'mock-user-001';
}

function startOf(unit: 'week' | 'month'): Date {
  const d = new Date();
  if (unit === 'week') {
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  } else {
    d.setUTCDate(1);
  }
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Request logger
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

const router = express.Router();

// ─── Applications CRUD ────────────────────────────────────────────────────────

// POST /v1/applications — create
router.post('/applications', (req: Request, res: Response) => {
  const userId = getUserId(req);
  const body = req.body as Record<string, unknown>;

  if (!body.jobTitle || typeof body.jobTitle !== 'string') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'jobTitle is required' } });
  }
  if (!body.company || typeof body.company !== 'string') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'company is required' } });
  }

  const status = (ALL_STATUSES.includes(body.status as ApplicationStatus) ? body.status : 'saved') as ApplicationStatus;
  const now = new Date().toISOString();
  const id = ulid();

  const app: Application = {
    id,
    userId,
    jobTitle: (body.jobTitle as string).trim(),
    company: (body.company as string).trim(),
    url: body.url as string | undefined,
    location: body.location as string | undefined,
    salaryRange: body.salaryRange as string | undefined,
    status,
    coverLetterId: body.coverLetterId as string | undefined,
    resumeVersionId: body.resumeVersionId as string | undefined,
    createdAt: now,
    updatedAt: now,
    appliedAt: status === 'applied' ? now : undefined,
    version: 1,
  };

  applications.set(appKey(userId, id), app);
  statusHistory.set(historyKey(userId, id), [
    { applicationId: id, fromStatus: null, toStatus: status, changedAt: now },
  ]);

  return res.status(201).json({ application: toApiShape(app) });
});

// GET /v1/applications — list
router.get('/applications', (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { status, company, search, sortBy = 'updatedAt', sortOrder = 'desc', limit = '50', cursor } = req.query as Record<string, string>;

  let items = [...applications.values()].filter((a) => a.userId === userId);

  // Filter
  if (status) {
    const statuses = status.split(',').map((s) => s.trim());
    items = items.filter((a) => statuses.includes(a.status));
  }
  if (company) {
    const q = company.toLowerCase();
    items = items.filter((a) => a.company.toLowerCase().includes(q));
  }
  if (search) {
    const q = search.toLowerCase();
    items = items.filter((a) =>
      a.jobTitle.toLowerCase().includes(q) || a.company.toLowerCase().includes(q),
    );
  }

  // Sort
  const field = ['createdAt', 'updatedAt', 'company'].includes(sortBy) ? sortBy : 'updatedAt';
  items.sort((a, b) => {
    const av = a[field as keyof Application] as string;
    const bv = b[field as keyof Application] as string;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortOrder === 'asc' ? cmp : -cmp;
  });

  // Pagination
  const pageSize = Math.min(parseInt(limit, 10) || 50, 100);
  let startIdx = 0;
  if (cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      startIdx = items.findIndex((a) => a.id === decoded.id) + 1;
    } catch {
      startIdx = 0;
    }
  }

  const page = items.slice(startIdx, startIdx + pageSize);
  const hasMore = startIdx + pageSize < items.length;
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ id: page[page.length - 1].id })).toString('base64url')
    : undefined;

  return res.json({
    applications: page.map(toApiShape),
    nextCursor,
    totalCount: items.length,
  });
});

// GET /v1/applications/:id — get by ID
router.get('/applications/:id', (req: Request, res: Response) => {
  const userId = getUserId(req);
  const app = applications.get(appKey(userId, req.params['id']));
  if (!app) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Application not found' } });

  const history = (statusHistory.get(historyKey(userId, req.params['id'])) ?? [])
    .map(({ applicationId: _a, ...rest }) => rest);

  return res.json({ application: toApiShape(app), statusHistory: history });
});

// PATCH /v1/applications/:id — update
router.patch('/applications/:id', (req: Request, res: Response) => {
  const userId = getUserId(req);
  const existing = applications.get(appKey(userId, req.params['id']));
  if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Application not found' } });

  const body = req.body as Record<string, unknown>;

  if (body.version === undefined || typeof body.version !== 'number') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'version is required' } });
  }
  if (body.version !== existing.version) {
    return res.status(409).json({ error: { code: 'VERSION_CONFLICT', message: 'Application was modified by another request' } });
  }

  const now = new Date().toISOString();
  const updated: Application = {
    ...existing,
    jobTitle: typeof body.jobTitle === 'string' ? body.jobTitle.trim() : existing.jobTitle,
    company: typeof body.company === 'string' ? body.company.trim() : existing.company,
    url: 'url' in body ? (body.url as string | undefined) ?? undefined : existing.url,
    location: 'location' in body ? (body.location as string | undefined) ?? undefined : existing.location,
    salaryRange: 'salaryRange' in body ? (body.salaryRange as string | undefined) ?? undefined : existing.salaryRange,
    coverLetterId: 'coverLetterId' in body ? (body.coverLetterId as string | undefined) ?? undefined : existing.coverLetterId,
    resumeVersionId: 'resumeVersionId' in body ? (body.resumeVersionId as string | undefined) ?? undefined : existing.resumeVersionId,
    updatedAt: now,
    version: existing.version + 1,
  };

  applications.set(appKey(userId, req.params['id']), updated);
  return res.json({ application: toApiShape(updated) });
});

// DELETE /v1/applications/:id — delete
router.delete('/applications/:id', (req: Request, res: Response) => {
  const userId = getUserId(req);
  const key = appKey(userId, req.params['id']);
  if (!applications.has(key)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Application not found' } });
  }
  applications.delete(key);
  statusHistory.delete(historyKey(userId, req.params['id']));
  return res.status(204).send();
});

// ─── Status transitions ───────────────────────────────────────────────────────

// POST /v1/applications/:id/status
router.post('/applications/:id/status', (req: Request, res: Response) => {
  const userId = getUserId(req);
  const existing = applications.get(appKey(userId, req.params['id']));
  if (!existing) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Application not found' } });

  const body = req.body as Record<string, unknown>;
  const newStatus = body.status as ApplicationStatus;

  if (!ALL_STATUSES.includes(newStatus)) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `status must be one of: ${ALL_STATUSES.join(', ')}` } });
  }
  if (body.version === undefined || typeof body.version !== 'number') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'version is required' } });
  }
  if (body.version !== existing.version) {
    return res.status(409).json({ error: { code: 'VERSION_CONFLICT', message: 'Application was modified by another request' } });
  }
  if (!VALID_TRANSITIONS[existing.status].includes(newStatus)) {
    return res.status(400).json({
      error: {
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot transition from '${existing.status}' to '${newStatus}'`,
        details: {
          currentStatus: existing.status,
          requestedStatus: newStatus,
          allowedStatuses: VALID_TRANSITIONS[existing.status],
        },
      },
    });
  }

  const now = new Date().toISOString();
  const updated: Application = {
    ...existing,
    status: newStatus,
    updatedAt: now,
    appliedAt: newStatus === 'applied' ? now : existing.appliedAt,
    version: existing.version + 1,
  };

  applications.set(appKey(userId, req.params['id']), updated);

  const entry: StatusHistoryEntry = {
    applicationId: existing.id,
    fromStatus: existing.status,
    toStatus: newStatus,
    changedAt: now,
    note: body.note as string | undefined,
  };
  const history = statusHistory.get(historyKey(userId, req.params['id'])) ?? [];
  history.push(entry);
  statusHistory.set(historyKey(userId, req.params['id']), history);

  const historyForResponse = history.map(({ applicationId: _a, ...rest }) => rest);

  return res.json({ application: toApiShape(updated), statusHistory: historyForResponse });
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard', (req: Request, res: Response) => {
  const userId = getUserId(req);
  const userApps = [...applications.values()].filter((a) => a.userId === userId);

  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  for (const app of userApps) {
    byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
  }

  const weekStart = startOf('week');
  const monthStart = startOf('month');
  let appliedThisWeek = 0;
  let appliedThisMonth = 0;

  for (const app of userApps) {
    if (app.appliedAt) {
      const d = new Date(app.appliedAt);
      if (d >= weekStart) appliedThisWeek++;
      if (d >= monthStart) appliedThisMonth++;
    }
  }

  const applied = byStatus['applied'] ?? 0;
  const responded = (byStatus['phone_screen'] ?? 0) + (byStatus['interview'] ?? 0) +
    (byStatus['offer'] ?? 0) + (byStatus['rejected'] ?? 0);
  const responseRate = applied > 0 ? Math.round((responded / applied) * 100) / 100 : 0;

  const recentActivity = userApps
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10)
    .map((app) => ({
      applicationId: app.id,
      jobTitle: app.jobTitle,
      company: app.company,
      action: app.status === 'saved' ? 'created' : 'status_changed',
      toStatus: app.status,
      timestamp: app.updatedAt,
    }));

  return res.json({
    stats: {
      total: userApps.length,
      byStatus,
      appliedThisWeek,
      appliedThisMonth,
      responseRate,
    },
    recentActivity,
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', mode: 'mock', timestamp: new Date().toISOString() });
});

app.use('/v1', router);

// ─── Seed data (optional — comment out if you want a clean start) ─────────────

const SEED_USER = 'mock-user-001';
const seedApps: Omit<Application, 'userId'>[] = [
  {
    id: ulid(), jobTitle: 'Senior Software Engineer', company: 'Acme Corp',
    url: 'https://acme.com/careers/senior-swe', location: 'Remote (US)', salaryRange: '$150k-180k',
    status: 'applied', createdAt: '2026-04-10T08:00:00.000Z', updatedAt: '2026-04-15T10:30:00.000Z',
    appliedAt: '2026-04-15T10:30:00.000Z', version: 2,
  },
  {
    id: ulid(), jobTitle: 'Staff Engineer', company: 'TechStart Inc',
    location: 'San Francisco, CA', salaryRange: '$180k-220k',
    status: 'phone_screen', createdAt: '2026-04-08T14:00:00.000Z', updatedAt: '2026-04-14T09:00:00.000Z',
    appliedAt: '2026-04-10T11:00:00.000Z', version: 3,
  },
  {
    id: ulid(), jobTitle: 'Principal Engineer', company: 'BigTech Co',
    url: 'https://bigtech.com/jobs/principal', location: 'Remote',
    status: 'saved', createdAt: '2026-04-14T16:00:00.000Z', updatedAt: '2026-04-14T16:00:00.000Z',
    version: 1,
  },
];

for (const seed of seedApps) {
  const withUser: Application = { ...seed, userId: SEED_USER };
  applications.set(appKey(SEED_USER, seed.id), withUser);
  statusHistory.set(historyKey(SEED_USER, seed.id), [
    { applicationId: seed.id, fromStatus: null, toStatus: seed.status, changedAt: seed.createdAt },
  ]);
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   Job Application Manager — Mock API Server          ║
║   http://localhost:${PORT}/v1                           ║
╠══════════════════════════════════════════════════════╣
║  Auth: any Bearer token (or omit — uses mock-user)   ║
║  Data: in-memory (resets on restart)                 ║
║  Seed: 3 sample applications pre-loaded              ║
╚══════════════════════════════════════════════════════╝

Routes:
  GET    /v1/health
  GET    /v1/applications
  POST   /v1/applications
  GET    /v1/applications/:id
  PATCH  /v1/applications/:id
  DELETE /v1/applications/:id
  POST   /v1/applications/:id/status
  GET    /v1/dashboard
`);
});
