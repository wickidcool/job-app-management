import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopNavigation } from './components/TopNavigation';
import { MobileNavigation } from './components/MobileNavigation';
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
import { ReportsPipeline } from './pages/ReportsPipeline';
import { ReportsNeedsAction } from './pages/ReportsNeedsAction';
import { ReportsStale } from './pages/ReportsStale';
import { ReportsClosedLoop } from './pages/ReportsClosedLoop';
import { ReportsByFitTier } from './pages/ReportsByFitTier';
import { useApplications } from './hooks/useApplications';
import { useExports } from './hooks/useExports';

function App() {
  const { data: applications = [] } = useApplications();
  const { data: exports = [] } = useExports();

  const inProgressCount = applications.filter(
    (app) => app.status === 'phone_screen' || app.status === 'interview'
  ).length;

  const exportCount = exports.length;

  return (
    <BrowserRouter>
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

        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/applications" element={<ApplicationsList />} />
            <Route path="/applications/new" element={<ApplicationNew />} />
            <Route path="/applications/:id" element={<ApplicationDetail />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reports/pipeline" element={<ReportsPipeline />} />
            <Route path="/reports/needs-action" element={<ReportsNeedsAction />} />
            <Route path="/reports/stale" element={<ReportsStale />} />
            <Route path="/reports/closed-loop" element={<ReportsClosedLoop />} />
            <Route path="/reports/by-fit-tier" element={<ReportsByFitTier />} />
            <Route path="/resumes" element={<ResumeManager />} />
            <Route path="/resumes/upload" element={<ResumeUpload />} />
            <Route path="/resumes/exports" element={<ResumeExports />} />
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/projects" element={<ProjectsList />} />
            <Route path="/projects/new/dialogue" element={<DialogueCapture />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
            <Route
              path="/projects/:projectId/files/:fileName"
              element={<ProjectFileEditor />}
            />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
