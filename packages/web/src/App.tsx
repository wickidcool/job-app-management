import { RouterProvider, Routes, Route, Navigate, createBrowserRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider } from './contexts/AuthContext';
import { OnboardingProvider } from './contexts/OnboardingContext';
import { RouteMatchProvider } from './contexts/RouteMatchContext';
import { CommandPaletteProvider, useCommandPalette } from './contexts/CommandPaletteContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { OnboardingModal } from './components/onboarding';
import { Login } from './pages/Login';
import { TopNavigation } from './components/TopNavigation';
import { MobileNavigation } from './components/MobileNavigation';
import { BottomTabBar } from './components/BottomTabBar';
import { CommandPalette } from './components/CommandPalette';
import { RouteTitle } from './components/RouteTitle';
import { Dashboard } from './pages/Dashboard';
import { ApplicationsList } from './pages/ApplicationsList';
import { ApplicationDetail } from './pages/ApplicationDetail';
import { ApplicationNew } from './pages/ApplicationNew';
import { ResumeManager } from './pages/ResumeManager';
import { ResumeUpload } from './pages/ResumeUpload';
import { ResumeExports } from './pages/ResumeExports';
import { ProjectsList } from './pages/ProjectsList';
import { ProjectDetail } from './pages/ProjectDetail';
import { ProjectFileEditor } from './pages/ProjectFileEditor';
import { DialogueCapture } from './pages/DialogueCapture';
import { CatalogPage } from './pages/CatalogPage';
import { Settings } from './pages/Settings';
import { Reports } from './pages/Reports';
import { ReportsNeedsAction } from './pages/ReportsNeedsAction';
import { ReportsStale } from './pages/ReportsStale';
import { ReportsClosedLoop } from './pages/ReportsClosedLoop';
import { ReportsByFitTier } from './pages/ReportsByFitTier';
import { JobFitAnalysis } from './pages/JobFitAnalysis';
import { JobFitAnalysisDetail } from './pages/JobFitAnalysisDetail';
import { CoverLettersList } from './pages/CoverLettersList';
import { CoverLetterNew } from './pages/CoverLetterNew';
import { CoverLetterDetail } from './pages/CoverLetterDetail';
import { OutreachNew } from './pages/OutreachNew';
import { ResumeVariantsList } from './pages/ResumeVariantsList';
import { ResumeVariantDetail } from './pages/ResumeVariantDetail';
import { ResumeVariantNew } from './pages/ResumeVariantNew';
import { InterviewPrepPage } from './pages/InterviewPrepPage';
import { NotFound } from './pages/NotFound';
import { useApplicationCollection } from './hooks/useApplications';
import { useExports } from './hooks/useExports';

/**
 * Cross-cutting state the app shell needs but no single route owns: whether the
 * current URL matched a route, and whether the command palette is open. Composed
 * into one wrapper so adding either does not push the route table a level deeper.
 */
function AppShellProviders({ children }: { children: ReactNode }) {
  return (
    <RouteMatchProvider>
      <CommandPaletteProvider>{children}</CommandPaletteProvider>
    </RouteMatchProvider>
  );
}

/**
 * Bridges the palette's context state onto its controlled props. `App` renders the
 * provider, so `App` itself cannot call the hook; this is the smallest seam that
 * keeps `CommandPalette`'s existing `open`/`onOpenChange` API untouched.
 */
function CommandPaletteHost() {
  const { open, setOpen } = useCommandPalette();
  return <CommandPalette open={open} onOpenChange={setOpen} />;
}

/**
 * Everything that used to live directly inside `<BrowserRouter>`. Split out so the
 * router can be created once at module scope and mount this as its element — see
 * `router` below.
 */
function AppShell() {
  // `useApplicationCollection`, not the `useApplications` projection this used to call
  // (WIC-2181). Same query key, same fetch, same cache entry — but the rows arrive with
  // `truncated` attached instead of stripped off, and the two nav badges below are
  // counts, which is exactly what that flag qualifies.
  const { data: applicationCollection } = useApplicationCollection();
  const applications = applicationCollection?.applications ?? [];
  const { data: exports = [] } = useExports();

  const inProgressCount = applications.filter(
    (app) => app.status === 'phone_screen' || app.status === 'interview'
  ).length;
  // `inProgressCount` is a client-side filter over whatever rows we were handed. If
  // `getAllPaged` ran out of page budget those rows are a prefix, so the badge is a lower
  // bound, not a count — the nav renders it as "12+" rather than "12". Reachable only at
  // MAX_APPLICATION_PAGES x APPLICATION_PAGE_SIZE = 5,000 applications for one user, so
  // in practice this is always `false`; it is here because a nav badge that quietly
  // undercounts has no other signal anywhere on screen.
  const inProgressCountIsLowerBound = applicationCollection?.truncated ?? false;

  const exportCount = exports.length;

  return (
    <AuthProvider>
      <OnboardingProvider>
        <AppShellProviders>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <div className="min-h-screen bg-neutral-50">
                    {/* Renders nothing; applies the route table's document.title (WIC-1089). */}
                    <RouteTitle />
                    <div className="hidden md:block">
                      <TopNavigation
                        applicationCount={inProgressCount}
                        applicationCountIsLowerBound={inProgressCountIsLowerBound}
                        exportCount={exportCount}
                      />
                    </div>
                    <div className="md:hidden">
                      <MobileNavigation
                        applicationCount={inProgressCount}
                        applicationCountIsLowerBound={inProgressCountIsLowerBound}
                        exportCount={exportCount}
                      />
                    </div>

                    <main className="pb-20 md:pb-0">
                      <Routes>
                        <Route path="/" element={<Dashboard />} />
                        {/* `/dashboard` shipped in nav links and is in real bookmarks and
                            browser histories. `replace` keeps the dead URL out of history so
                            the back button does not lead into it. */}
                        <Route path="/dashboard" element={<Navigate to="/" replace />} />
                        <Route path="/applications" element={<ApplicationsList />} />
                        <Route path="/applications/new" element={<ApplicationNew />} />
                        <Route path="/applications/:id" element={<ApplicationDetail />} />
                        <Route path="/applications/:id/prep" element={<InterviewPrepPage />} />
                        <Route path="/reports" element={<Reports />} />
                        <Route
                          path="/reports/pipeline"
                          element={<Navigate to="/applications" replace />}
                        />
                        <Route path="/reports/needs-action" element={<ReportsNeedsAction />} />
                        <Route path="/reports/stale" element={<ReportsStale />} />
                        <Route path="/reports/closed-loop" element={<ReportsClosedLoop />} />
                        <Route path="/reports/by-fit-tier" element={<ReportsByFitTier />} />
                        <Route path="/resumes" element={<ResumeManager />} />
                        <Route path="/resumes/upload" element={<ResumeUpload />} />
                        <Route path="/resumes/exports" element={<ResumeExports />} />
                        <Route path="/resumes/:resumeId/exports" element={<ResumeExports />} />
                        <Route path="/catalog" element={<CatalogPage />} />
                        <Route path="/job-fit-analysis" element={<JobFitAnalysis />} />
                        <Route path="/job-fit-analysis/:id" element={<JobFitAnalysisDetail />} />
                        <Route path="/cover-letters" element={<CoverLettersList />} />
                        <Route path="/cover-letters/new" element={<CoverLetterNew />} />
                        <Route path="/cover-letters/:id" element={<CoverLetterDetail />} />
                        <Route path="/outreach/new" element={<OutreachNew />} />
                        <Route path="/resume-variants" element={<ResumeVariantsList />} />
                        <Route path="/resume-variants/new" element={<ResumeVariantNew />} />
                        <Route path="/resume-variants/:id" element={<ResumeVariantDetail />} />
                        <Route path="/projects" element={<ProjectsList />} />
                        <Route path="/projects/new/dialogue" element={<DialogueCapture />} />
                        <Route path="/projects/:projectId" element={<ProjectDetail />} />
                        <Route
                          path="/projects/:projectId/files/:fileName"
                          element={<ProjectFileEditor />}
                        />
                        <Route path="/settings" element={<Settings />} />
                        {/* Must stay last: catches every in-app path with no route
                            so an unmatched URL shows a 404 page, not an empty <main>. */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </main>

                    <BottomTabBar applicationCount={inProgressCount} exportCount={exportCount} />

                    <CommandPaletteHost />

                    {/* Onboarding Modal */}
                    <OnboardingModal />
                  </div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </AppShellProviders>
      </OnboardingProvider>
    </AuthProvider>
  );
}

/**
 * The data router (WIC-1924).
 *
 * ## Why a single catch-all route rather than 30 route objects
 *
 * The only thing this migration is *for* is `useBlocker`, which the dialogue wizard
 * needs to confirm before browser Back throws away unsaved answers. `useBlocker` reads
 * `DataRouterContext`, which `RouterProvider` supplies at the top — it does not care how
 * the tree below matched. Descendant `<Routes>` keep working underneath it, and blocking
 * still covers every `navigate()` and `popstate` in the app, because there is only one
 * router. Measured, not assumed: `App.dataRouter.test.tsx` mounts this real router and
 * drives a blocked navigation through the nested `<Routes>` below.
 *
 * So the route table stays JSX, and that is deliberate rather than lazy. Five test files
 * read the `Route` elements below out of this file as *source text* —
 * `route-integrity.test.ts` (both directions of the link/route join),
 * `route-title-coverage.test.ts`, `routeOutline.render.test.tsx`,
 * `routeOutline.source.test.ts` and `routeHeadingOutline.test.ts`. Converting the table
 * to `createBrowserRouter([{ path: '/applications', element: … }])` would take every one
 * of them to zero matches at once. Their "did the parse match anything at all" floors
 * would red, so it would not pass silently — but the only way through is to rewrite five
 * scrapers, in the same change as the router move, for no behaviour this app can use:
 * every page fetches through React Query, so there is not a single `loader` or `action`
 * to migrate. That trade buys nothing and spends the route inventory.
 *
 * The cost of stopping here is real and worth naming: per-route `loader`/`action`/
 * `lazy` are not available until the table becomes route objects. Nothing here wants
 * them today, and that conversion is purely additive when something does.
 *
 * Created at module scope on purpose — `createBrowserRouter` inside the component body
 * would build a new router, and so discard all history state, on every render.
 */
const router = createBrowserRouter([{ path: '*', element: <AppShell /> }]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
