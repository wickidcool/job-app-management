import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CoverLetterGenerator } from '../components/CoverLetterGenerator';
import type { CatalogEntry, CoverLetterResult } from '../services/api/types';

export function CoverLetterNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const fitAnalysisId = searchParams.get('fitAnalysisId') || undefined;
  const applicationId = searchParams.get('applicationId') || undefined;

  // Mock catalog entries - In production, these would come from the API
  const [catalogEntries] = useState<CatalogEntry[]>([
    {
      id: 'star-1',
      title: 'Led React migration for client portal',
      situation: 'Client portal built on Angular 1.x was becoming unmaintainable',
      task: 'Migrate to React while maintaining feature parity and zero downtime',
      action: 'Created migration plan, built component library, implemented parallel routing',
      result: 'Reduced bundle size by 40%, improved load times by 2 seconds, increased test coverage to 85%',
      tags: ['Frontend', 'React', 'Migration', 'Performance'],
      timeframe: 'Q3 2024',
      relevanceScore: 95,
      relevanceReasoning: 'Directly demonstrates frontend expertise and migration skills',
    },
    {
      id: 'star-2',
      title: 'Scaled Node.js API to 10k req/sec',
      situation: 'API struggling under growing user load',
      task: 'Scale API to handle 10x traffic without infrastructure cost increase',
      action: 'Implemented caching layer, optimized database queries, added horizontal scaling',
      result: 'Increased throughput to 10k req/s, reduced p99 latency from 800ms to 120ms',
      tags: ['Backend', 'Node.js', 'Performance', 'Scaling'],
      timeframe: 'Q1 2025',
      relevanceScore: 90,
      relevanceReasoning: 'Proves backend proficiency and scaling skills',
    },
    {
      id: 'star-3',
      title: 'PostgreSQL query optimization',
      situation: 'Dashboard queries taking 5+ seconds',
      task: 'Optimize queries to meet <500ms SLA',
      action: 'Added indexes, rewrote N+1 queries, implemented materialized views',
      result: 'Reduced query time to 200ms average, dashboard load time improved by 75%',
      tags: ['Database', 'PostgreSQL', 'Performance', 'Optimization'],
      timeframe: 'Q2 2024',
      relevanceScore: 85,
      relevanceReasoning: 'Shows database expertise',
    },
    {
      id: 'star-4',
      title: 'Built CI/CD pipeline',
      situation: 'Manual deployments causing errors and delays',
      task: 'Automate build, test, and deployment pipeline',
      action: 'Set up GitHub Actions, implemented automated testing, blue-green deployments',
      result: 'Deploy time reduced from 2 hours to 15 minutes, zero-downtime releases',
      tags: ['DevOps', 'CI/CD', 'Automation'],
      timeframe: 'Q4 2024',
    },
    {
      id: 'star-5',
      title: 'Mentored 3 junior developers',
      situation: 'Team lacked mid-level developers',
      task: 'Grow junior developers into autonomous contributors',
      action: 'Weekly 1:1s, code review training, pair programming sessions',
      result: 'All 3 promoted to mid-level within 12 months, team velocity increased 30%',
      tags: ['Leadership', 'Mentoring', 'Team Development'],
      timeframe: 'Q1 2024',
    },
  ]);

  const handleComplete = (result: CoverLetterResult) => {
    console.log('Cover letter generated:', result);
    // TODO: Save to API
    // Navigate to cover letter detail or back to application
    if (applicationId) {
      navigate(`/applications/${applicationId}`);
    } else {
      navigate('/cover-letters');
    }
  };

  const handleCancel = () => {
    if (applicationId) {
      navigate(`/applications/${applicationId}`);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <CoverLetterGenerator
        fitAnalysisId={fitAnalysisId}
        applicationId={applicationId}
        catalogEntries={catalogEntries}
        onComplete={handleComplete}
        onCancel={handleCancel}
      />
    </div>
  );
}
