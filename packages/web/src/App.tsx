import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopNavigation } from './components/TopNavigation';
import { MobileNavigation } from './components/MobileNavigation';
import { Dashboard } from './pages/Dashboard';
import { ApplicationsList } from './pages/ApplicationsList';
import { ApplicationDetail } from './pages/ApplicationDetail';
import { ResumeManager } from './pages/ResumeManager';
import { ResumeUpload } from './pages/ResumeUpload';
import { ResumeExports } from './pages/ResumeExports';
import { Settings } from './pages/Settings';
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
            <Route path="/applications/:id" element={<ApplicationDetail />} />
            <Route path="/resumes" element={<ResumeManager />} />
            <Route path="/resumes/upload" element={<ResumeUpload />} />
            <Route path="/resumes/exports" element={<ResumeExports />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
