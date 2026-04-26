import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CoverLetterPreview } from '../components/CoverLetterPreview';
import type { CoverLetterVariant } from '../services/api/types';

export function CoverLetterDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Mock data - In production, fetch from API based on id
  const [content] = useState(`Dear Hiring Manager,

I am writing to express my strong interest in the Senior Full Stack Engineer position at TechCorp Inc. With over five years of experience building scalable web applications using React, Node.js, and PostgreSQL, I am confident I can contribute immediately to your team.

In my current role at StartupCo, I led the migration of our client portal from Angular to React, reducing bundle size by 40% and improving load times by 2 seconds. This experience directly aligns with the frontend expertise your team is seeking.

I have also worked extensively on backend systems, scaling Node.js APIs to handle thousands of requests per second while maintaining high reliability and performance standards. My work on database optimization reduced query times by 75%, significantly improving user experience.

I am excited about the opportunity to bring my skills to TechCorp Inc and would welcome the chance to discuss how my experience aligns with your needs.

Sincerely,
[Your Name]`);

  const [variant] = useState<CoverLetterVariant>({
    tone: 'professional',
    length: 'standard',
    emphasis: 'balanced',
  });

  const handleCopy = () => {
    console.log('Cover letter copied to clipboard');
  };

  const handleDownload = (format: 'docx' | 'pdf') => {
    console.log(`Downloading as ${format}`);
    // TODO: Implement download functionality
  };

  const wordCount = content.split(/\s+/).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate(-1)}
              className="text-sm text-gray-600 hover:text-gray-900 mb-2"
            >
              ← Back
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Cover Letter</h1>
            <p className="text-sm text-gray-600">ID: {id}</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/cover-letters/${id}/edit`)}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => console.log('Delete cover letter')}
              className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto py-8">
        <div className="bg-white border rounded-lg shadow-sm overflow-hidden" style={{ height: '800px' }}>
          <CoverLetterPreview
            content={content}
            variant={variant}
            wordCount={wordCount}
            showExportActions={true}
            onCopy={handleCopy}
            onDownload={handleDownload}
          />
        </div>
      </div>
    </div>
  );
}
