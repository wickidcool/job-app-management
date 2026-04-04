import { describe, it, expect } from 'vitest';
import { matchJobDescription } from '../../src/matching/matcher.js';

const sampleIndex = `# Project Index

## Acme Corp
- **File:** acme-corp.md
- **Tech:** TypeScript, React, Node.js
- **Keywords:** REST API, authentication, OAuth

## Beta Inc
- **File:** beta-inc.md
- **Tech:** Python, Django, PostgreSQL
- **Keywords:** data pipeline, machine learning
`;

describe('matchJobDescription', () => {
  it('returns score of 1.0 when all job keywords match', () => {
    const result = matchJobDescription('TypeScript React Node.js', sampleIndex);
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
  });

  it('returns score of 0 when no keywords match', () => {
    const result = matchJobDescription('Cobol Fortran Assembly', sampleIndex);
    expect(result.score).toBe(0);
    expect(result.matchedKeywords).toEqual([]);
  });

  it('returns per-project scores sorted descending', () => {
    const result = matchJobDescription('TypeScript React', sampleIndex);
    expect(result.projectScores.length).toBe(2);
    expect(result.projectScores[0].score).toBeGreaterThanOrEqual(result.projectScores[1].score);
  });

  it('partial match returns Jaccard similarity', () => {
    // Job: TypeScript, React (2 terms).
    // Acme keywords after comma-split: typescript, react, node.js, rest api, authentication, oauth (6 terms)
    // Intersection: TypeScript, React (2). Union: 2 + 6 - 2 = 6
    // Jaccard = 2/6 ≈ 0.333
    const result = matchJobDescription('TypeScript React', sampleIndex);
    const acme = result.projectScores.find(p => p.slug === 'acme-corp');
    expect(acme).toBeDefined();
    expect(acme!.score).toBeCloseTo(2 / 6, 2);
  });

  it('returns matched and missed keywords', () => {
    const result = matchJobDescription('TypeScript Kubernetes', sampleIndex);
    expect(result.matchedKeywords).toContain('typescript');
    expect(result.missedKeywords).toContain('kubernetes');
  });
});
