import { NOT_FOUND_COPY } from '../pages/NotFound.copy';

/**
 * Per-route `document.title` — the single source for every title string in the app.
 *
 * Specified by `docs/design/ROUTE_TITLE_CONVENTION.md` (WIC-1089). Before this module
 * every route in the SPA shared the one static `<title>` in `index.html`, so the browser
 * tab, the history entry, the bookmark name and the window-switcher entry were identical
 * for all 31 routes — the textbook WCAG 2.4.2 (Page Titled, Level A) failure mode for a
 * single-page app, and the reason `Ctrl/Cmd+H` could not be used to return to a screen.
 *
 * The governing rule (§0.3) is that **a route's title is its `<h1>` verbatim**. That is
 * what keeps this table from becoming a second, drifting copy of the app's copy deck:
 * when a heading changes, its title is meant to change with it in the same commit. The
 * strings below were re-measured against the tree on 2026-09-01; every one is quoted from
 * the `<h1>` cited beside it, except the two marked "new copy" for routes that render no
 * heading at all (`docs/design/ROUTE_TITLE_CONVENTION.md` §6.1).
 */

/**
 * The product name, in one place.
 *
 * `Careerpin` is what the public marketing site (`packages/marketing/*.html`) and the
 * production host `app.careerpin.app` both say. Two other names are still in the repo —
 * `Job Application Manager` in `index.html` and on the login page, and `jobtrail` in the
 * root `package.json` — and the convention doc picked `Careerpin` on the evidence of the
 * first two rather than parking a WCAG A item behind a branding thread. If the board or
 * the Copywriter lands elsewhere, this constant is the only line that moves.
 */
export const PRODUCT_NAME = 'Careerpin';

/**
 * U+2014 EM DASH, with hairline spaces either side — the separator already deployed on
 * the marketing site (`About — Careerpin`). Note for anyone writing an assertion against
 * a title: this is not a hyphen, and Playwright's `toHaveTitle(string)` is an exact match.
 */
export const TITLE_SEPARATOR = ' — ';

/** `Dashboard` -> `Dashboard — Careerpin`. A blank or missing page name yields the bare product name. */
export function formatTitle(page?: string): string {
  const trimmed = page?.trim();
  return trimmed ? `${trimmed}${TITLE_SEPARATOR}${PRODUCT_NAME}` : PRODUCT_NAME;
}

/**
 * Routes whose title is a constant, applied by the one effect in the app shell
 * (`RouteTitle` in `App.tsx`). Keys are the `path` exactly as declared on the `<Route>`.
 */
export const STATIC_ROUTE_TITLES: Readonly<Record<string, string>> = {
  '/': 'Dashboard', //                                    Dashboard.tsx:37
  '/applications': 'Applications', //                     ApplicationsList.tsx:155
  '/applications/new': 'New Application', //              new copy — page renders no <h1> (§6.1)
  '/applications/:id/prep': 'Interview Preparation', //   InterviewPrepPage.tsx:263 — NOT the export modal's <h1> (§3.1)
  '/reports': 'Reports', //                               Reports.tsx:49
  '/reports/needs-action': 'Needs Action', //             ReportsNeedsAction.tsx:76
  '/reports/stale': 'Stale Applications', //              ReportsStale.tsx:41
  '/reports/closed-loop': 'Closed Loop Analysis', //      ReportsClosedLoop.tsx:113
  '/reports/by-fit-tier': 'By Fit Tier', //               ReportsByFitTier.tsx:227
  '/resumes': 'Resume Manager', //                        ResumeManager.tsx:119
  '/resumes/upload': 'Upload Resume', //                  ResumeUpload.tsx:35
  '/resumes/exports': 'Resume Exports', //                ResumeExports.tsx:52
  '/resumes/:resumeId/exports': 'Resume Exports', //      same component, `resumeId` optional
  '/catalog': 'Master Catalog Index', //                  CatalogBrowse/CatalogBrowseView.tsx:116
  '/cover-letters': 'Cover Letters', //                   CoverLettersList.tsx:54
  '/cover-letters/new': 'Generate Cover Letter', //       CoverLetterNew.tsx:47
  '/cover-letters/:id': 'Cover Letter', //                CoverLetterDetail.tsx:114
  '/outreach/new': 'Compose Outreach Message', //         OutreachNew.tsx:30
  '/resume-variants': 'Resume Variants', //               ResumeVariantsList.tsx:44
  '/resume-variants/new': 'Generate Resume Variant', //   ResumeVariantNew.tsx:114
  '/projects': 'Projects', //                             ProjectsList.tsx:107
  '/settings': 'Settings', //                             Settings.tsx:29
  // Read from the page's own copy block, never retyped: the apostrophe in
  // "couldn't" is a straight U+0027, not the typographic U+2019 that the em-dash
  // separator above would lead you to expect. See ROUTE_TITLE_CONVENTION.md §7.
  '*': NOT_FOUND_COPY.heading, //                         NotFound.tsx:90
};

/**
 * Routes that call `useDocumentTitle()` from the page itself rather than being titled by
 * the shell. Four vary by URL param, two by in-page stage or variant, and one — `/login`
 * — is simply mounted outside the shell.
 *
 * Listed here rather than merely omitted so that `route-title-coverage.test.ts` can tell
 * "this route delegates to a hook" apart from "somebody added a route and forgot the
 * title" — which is the failure this whole mechanism exists to make impossible.
 */
export const HOOK_TITLED_ROUTES: readonly string[] = [
  '/applications/:id', //                        ApplicationDetail.tsx:140  {application.jobTitle}
  '/resume-variants/:id', //                     ResumeVariantDetail.tsx:163 {variant.title}
  '/projects/:projectId', //                     ProjectDetail.tsx:40       {projectName}
  '/projects/:projectId/files/:fileName', //     ProjectFileEditor.tsx:66   {fileName}
  '/job-fit-analysis', //                        JobFitAnalysis.tsx:460 / :148, by stage
  '/projects/new/dialogue', //                   WizardContainer.tsx:399-401, by wizard variant
  // Not dynamic — `/login` sits in the *outer* <Routes> in App.tsx, above ProtectedRoute,
  // so the shell that applies STATIC_ROUTE_TITLES is never mounted for it. Same mechanism
  // as the six above, different reason; its string is LOGIN_TITLE below.
  '/login',
];

/**
 * Fallbacks the dynamic routes show while their record loads, so a title is never
 * `undefined — Careerpin` and never the *previous* route's title (§3, behaviour 2).
 */
export const DYNAMIC_TITLE_FALLBACKS = {
  application: 'Application',
  resumeVariant: 'Resume Variant',
  project: 'Project',
  projectFile: 'Project File',
} as const;

/**
 * Routes that only ever `<Navigate>` elsewhere. They never paint, so they must not set a
 * title — doing so would flash a title for a screen the user never sees, and would land
 * in history under a name for a URL that no longer exists.
 */
export const REDIRECT_ROUTES: readonly string[] = ['/dashboard', '/reports/pipeline'];

/**
 * `/login` sits in the *outer* `<Routes>` in `App.tsx`, above `ProtectedRoute`, so the
 * app shell that applies `STATIC_ROUTE_TITLES` is not mounted for it. `Login.tsx` calls
 * the hook with this directly.
 *
 * New copy: the page's highest heading is an `<h2>` and its text is the product name
 * rather than a description of the screen (§6.1) — so there is no `<h1>` to mirror.
 */
export const LOGIN_TITLE = 'Sign In';
