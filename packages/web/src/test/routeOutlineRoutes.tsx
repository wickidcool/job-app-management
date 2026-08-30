/**
 * Every route in `App.tsx`, with what it takes to render one.
 *
 * `routeOutline.render.test.tsx` asserts this table is *complete* against `App.tsx`
 * itself, so a route added to the app but not to this table fails rather than silently
 * dropping out of the sweep. That check is the reason this is a hand-written table and
 * not a glob over `pages/`: the unit of the WIC-1483 defect is a **route**, and
 * `ReportsPipeline.tsx` is the proof — the file still exists, but `/reports/pipeline` is
 * now a `<Navigate>`, so no route renders it and it is correctly out of scope.
 */

import type { ReactElement } from 'react';

import type { Branch } from './routeOutlineApiMock';

import { ApplicationDetail } from '../pages/ApplicationDetail';
import { ApplicationNew } from '../pages/ApplicationNew';
import { ApplicationsList } from '../pages/ApplicationsList';
import { CatalogPage } from '../pages/CatalogPage';
import { CoverLetterDetail } from '../pages/CoverLetterDetail';
import { CoverLetterNew } from '../pages/CoverLetterNew';
import { Dashboard } from '../pages/Dashboard';
import { DialogueCapture } from '../pages/DialogueCapture';
import { InterviewPrepPage } from '../pages/InterviewPrepPage';
import { JobFitAnalysis } from '../pages/JobFitAnalysis';
import { Login } from '../pages/Login';
import { NotFound } from '../pages/NotFound';
import { OutreachNew } from '../pages/OutreachNew';
import { ProjectDetail } from '../pages/ProjectDetail';
import { ProjectFileEditor } from '../pages/ProjectFileEditor';
import { ProjectsList } from '../pages/ProjectsList';
import { Reports } from '../pages/Reports';
import { ReportsByFitTier } from '../pages/ReportsByFitTier';
import { ReportsClosedLoop } from '../pages/ReportsClosedLoop';
import { ReportsNeedsAction } from '../pages/ReportsNeedsAction';
import { ReportsStale } from '../pages/ReportsStale';
import { ResumeExports } from '../pages/ResumeExports';
import { ResumeManager } from '../pages/ResumeManager';
import { ResumeUpload } from '../pages/ResumeUpload';
import { ResumeVariantDetail } from '../pages/ResumeVariantDetail';
import { ResumeVariantNew } from '../pages/ResumeVariantNew';
import { ResumeVariantsList } from '../pages/ResumeVariantsList';
import { Settings } from '../pages/Settings';

export interface RouteCase {
  /** The URL to mount at. */
  path: string;
  /** The route pattern, when the page reads `:id`-style params. Defaults to `path`. */
  pattern?: string;
  render: () => ReactElement;
  /** A route-specific API payload, where the harness's generic one is the wrong shape. */
  payload?: (branch: Branch) => unknown;
}

/** A report page's `{ generatedAt, applications, summary }` envelope. */
function report(extraSummary: Record<string, unknown>) {
  return (branch: Branch) => ({
    generatedAt: '2026-01-01T00:00:00.000Z',
    applications:
      branch === 'loaded'
        ? [
            {
              id: 'a1',
              jobTitle: 'Staff Engineer',
              company: 'Acme',
              status: 'applied',
              daysStale: 40,
              appliedDate: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              closedAt: '2026-01-01T00:00:00.000Z',
            },
          ]
        : [],
    summary: { total: branch === 'loaded' ? 1 : 0, ...extraSummary },
  });
}

export const ROUTES: RouteCase[] = [
  { path: '/', render: () => <Dashboard /> },
  { path: '/login', render: () => <Login /> },
  { path: '/applications', render: () => <ApplicationsList /> },
  { path: '/applications/new', render: () => <ApplicationNew /> },
  {
    path: '/applications/app-1',
    pattern: '/applications/:id',
    render: () => <ApplicationDetail />,
  },
  {
    path: '/applications/app-1/prep',
    pattern: '/applications/:id/prep',
    render: () => <InterviewPrepPage />,
  },
  { path: '/reports', render: () => <Reports /> },
  {
    path: '/reports/needs-action',
    render: () => <ReportsNeedsAction />,
    payload: report({ overdue: 0, dueSoon: 0, upcoming: 0 }),
  },
  {
    path: '/reports/stale',
    render: () => <ReportsStale />,
    payload: report({ averageDaysStale: 0, byStatus: {} }),
  },
  {
    path: '/reports/closed-loop',
    render: () => <ReportsClosedLoop />,
    payload: report({ averageTimeToClose: 0, offers: 0, rejections: 0, rejectionsByStage: {} }),
  },
  {
    path: '/reports/by-fit-tier',
    render: () => <ReportsByFitTier />,
    payload: report({ byTier: {}, notAnalyzed: 0 }),
  },
  { path: '/resumes', render: () => <ResumeManager /> },
  { path: '/resumes/upload', render: () => <ResumeUpload /> },
  { path: '/resumes/exports', render: () => <ResumeExports /> },
  {
    path: '/resumes/res-1/exports',
    pattern: '/resumes/:resumeId/exports',
    render: () => <ResumeExports />,
  },
  { path: '/catalog', render: () => <CatalogPage /> },
  { path: '/job-fit-analysis', render: () => <JobFitAnalysis /> },
  { path: '/cover-letters/new', render: () => <CoverLetterNew /> },
  {
    path: '/cover-letters/cl-1',
    pattern: '/cover-letters/:id',
    render: () => <CoverLetterDetail />,
  },
  { path: '/outreach/new', render: () => <OutreachNew /> },
  { path: '/resume-variants', render: () => <ResumeVariantsList /> },
  { path: '/resume-variants/new', render: () => <ResumeVariantNew /> },
  {
    // `variant.content.skills.categories` is read unguarded, so the generic payload's
    // flat row throws here rather than rendering — and an unrendered branch is an
    // unmeasured branch, not a clean one.
    path: '/resume-variants/rv-1',
    pattern: '/resume-variants/:id',
    render: () => <ResumeVariantDetail />,
    payload: () => ({
      variant: {
        id: 'rv-1',
        title: 'Row one',
        status: 'draft',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        content: {
          summary: 'summary',
          experience: [],
          education: [],
          skills: { categories: [] },
        },
      },
    }),
  },
  { path: '/projects', render: () => <ProjectsList /> },
  { path: '/projects/new/dialogue', render: () => <DialogueCapture /> },
  { path: '/projects/proj-1', pattern: '/projects/:projectId', render: () => <ProjectDetail /> },
  {
    // `useProjectFile` resolves to the file's text, and the page passes it straight to
    // `<Markdown>`, which asserts on a non-string child. The generic payload is an
    // array, so this route needs the scalar shape its one hook actually returns.
    path: '/projects/proj-1/files/notes.md',
    pattern: '/projects/:projectId/files/:fileName',
    render: () => <ProjectFileEditor />,
    // No markdown heading in the fixture. `<Markdown>` renders `# Notes` as a real
    // `<h1>`, which showed up as a second h1 on this route — a defect manufactured by
    // the fixture, not found in the page.
    payload: (branch) => (branch === 'loaded' ? 'Body text, deliberately headingless.\n' : ''),
  },
  { path: '/settings', render: () => <Settings /> },
  { path: '/nope', pattern: '*', render: () => <NotFound /> },
];
