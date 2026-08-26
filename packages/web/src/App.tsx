import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import { CoverLetterNew } from './pages/CoverLetterNew';
import { CoverLetterDetail } from './pages/CoverLetterDetail';
import { OutreachNew } from './pages/OutreachNew';
import { ResumeVariantsList } from './pages/ResumeVariantsList';
import { ResumeVariantDetail } from './pages/ResumeVariantDetail';
import { ResumeVariantNew } from './pages/ResumeVariantNew';
import { InterviewPrepPage } from './pages/InterviewPrepPage';
import { NotFound } from './pages/NotFound';
import { useApplications } from './hooks/useApplications';
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

function App() {
  const { data: applications = [] } = useApplications();
  const { data: exports = [] } = useExports();

  const inProgressCount = applications.filter(
    (app) => app.status === 'phone_screen' || app.status === 'interview'
  ).length;

  const exportCount = exports.length;

  return (
    <BrowserRouter>
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
                      <div className="hidden md:block">
                        <TopNavigation
                          applicationCount={inProgressCount}
                          exportCount={exportCount}
                        />
                      </div>
                      <div className="md:hidden">
                        <MobileNavigation
                          applicationCount={inProgressCount}
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
    </BrowserRouter>
  );
}

export default App;
