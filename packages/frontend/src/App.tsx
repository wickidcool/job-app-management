import { Routes, Route, Link } from 'react-router-dom';
import ProjectsPage from './pages/ProjectsPage.js';
import UploadPage from './pages/UploadPage.js';
import IndexPage from './pages/IndexPage.js';
import MatchPage from './pages/MatchPage.js';
import CoverLetterPage from './pages/CoverLetterPage.js';

export default function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <nav style={{ marginBottom: 24, display: 'flex', gap: 16 }}>
        <Link to="/">Projects</Link>
        <Link to="/upload">Upload Resume</Link>
        <Link to="/index">Index</Link>
        <Link to="/match">Job Match</Link>
        <Link to="/cover-letter">Cover Letter</Link>
      </nav>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/index" element={<IndexPage />} />
        <Route path="/match" element={<MatchPage />} />
        <Route path="/cover-letter" element={<CoverLetterPage />} />
      </Routes>
    </div>
  );
}
