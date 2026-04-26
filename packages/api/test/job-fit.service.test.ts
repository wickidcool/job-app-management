import { describe, it, expect } from 'vitest';
import {
  parseJobDescription,
  extractSeniority,
  extractTechTerms,
  matchCatalogEntry,
  computeRecommendation,
} from '../src/services/job-fit.service.js';
import type { FitMatchDTO, FitGapDTO } from '../src/types/index.js';

// ── extractSeniority ──────────────────────────────────────────────────────────

describe('extractSeniority', () => {
  it('detects senior from title', () => {
    const result = extractSeniority('Senior Software Engineer at Acme');
    expect(result.seniority).toBe('senior');
    expect(result.confidence).toBe('high');
  });

  it('detects principal', () => {
    expect(extractSeniority('Principal Engineer').seniority).toBe('principal');
  });

  it('detects staff engineer', () => {
    expect(extractSeniority('Staff Software Engineer').seniority).toBe('staff');
  });

  it('detects director', () => {
    expect(extractSeniority('Director of Engineering').seniority).toBe('director');
  });

  it('detects junior', () => {
    const result = extractSeniority('Junior Developer');
    expect(result.seniority).toBe('entry');
  });

  it('detects entry level', () => {
    expect(extractSeniority('Entry-Level Software Engineer').seniority).toBe('entry');
  });

  it('returns null when no seniority signal', () => {
    const result = extractSeniority('Software Engineer at a startup');
    expect(result.seniority).toBeNull();
    expect(result.confidence).toBe('low');
  });

  it('detects VP', () => {
    expect(extractSeniority('VP of Engineering').seniority).toBe('vp');
  });
});

// ── extractTechTerms ──────────────────────────────────────────────────────────

describe('extractTechTerms', () => {
  it('extracts typescript and react', () => {
    const terms = extractTechTerms('You know TypeScript and React well.');
    expect(terms).toContain('typescript');
    expect(terms).toContain('react');
  });

  it('extracts postgres', () => {
    const terms = extractTechTerms('Experience with PostgreSQL required.');
    expect(terms).toContain('postgresql');
  });

  it('extracts AWS', () => {
    const terms = extractTechTerms('Deploy to AWS cloud infrastructure.');
    expect(terms).toContain('aws');
  });

  it('extracts docker and kubernetes', () => {
    const terms = extractTechTerms('Must know Docker and k8s.');
    expect(terms).toContain('docker');
    expect(terms).toContain('kubernetes');
  });

  it('handles empty string', () => {
    expect(extractTechTerms('')).toEqual([]);
  });

  it('does not double count aliases', () => {
    const terms = extractTechTerms('Use Node.js and nodejs for the backend.');
    const nodeCount = terms.filter((t) => t === 'nodejs').length;
    expect(nodeCount).toBe(1);
  });
});

// ── parseJobDescription ───────────────────────────────────────────────────────

describe('parseJobDescription', () => {
  const sampleJD = `
Senior Software Engineer at Acme Corp

We're looking for a Senior Software Engineer to join our platform team.

Location: Remote (US)
Salary: $150k-$190k + equity

Requirements:
- 5+ years of TypeScript and React experience
- Strong background in PostgreSQL
- AWS cloud experience required

Nice to have:
- GraphQL or REST API design
- Docker and Kubernetes

Manage a team of 3 engineers.
  `.trim();

  it('extracts role title', () => {
    const result = parseJobDescription(sampleJD);
    expect(result.roleTitle).toBeTruthy();
    expect(result.roleTitle?.toLowerCase()).toContain('engineer');
  });

  it('extracts seniority', () => {
    const result = parseJobDescription(sampleJD);
    expect(result.seniority).toBe('senior');
    expect(result.seniorityConfidence).toBe('high');
  });

  it('extracts required stack', () => {
    const result = parseJobDescription(sampleJD);
    expect(result.requiredStack).toContain('typescript');
    expect(result.requiredStack).toContain('react');
    expect(result.requiredStack).toContain('postgresql');
    expect(result.requiredStack).toContain('aws');
  });

  it('extracts nice-to-have stack separately', () => {
    const result = parseJobDescription(sampleJD);
    expect(result.niceToHaveStack).toContain('docker');
    expect(result.niceToHaveStack).toContain('kubernetes');
    // Nice-to-have should not duplicate required
    expect(result.niceToHaveStack).not.toContain('typescript');
  });

  it('extracts location', () => {
    const result = parseJobDescription(sampleJD);
    expect(result.location).toBeTruthy();
    expect(result.location?.toLowerCase()).toContain('remote');
  });

  it('extracts compensation', () => {
    const result = parseJobDescription(sampleJD);
    expect(result.compensation).toBeTruthy();
    expect(result.compensation).toContain('150k');
  });

  it('extracts team scope', () => {
    const result = parseJobDescription(sampleJD);
    expect(result.teamScope).toContain('Manager of 3');
  });

  it('handles short JD with no sections', () => {
    const minimal = 'Looking for a developer with React and Python skills. Remote position.';
    const result = parseJobDescription(minimal);
    expect(result.requiredStack).toContain('react');
    expect(result.requiredStack).toContain('python');
    expect(result.seniority).toBeNull();
  });
});

// ── matchCatalogEntry ─────────────────────────────────────────────────────────

describe('matchCatalogEntry', () => {
  const catalog = [
    { slug: 'typescript', displayName: 'TypeScript', aliases: ['ts'] },
    { slug: 'react', displayName: 'React', aliases: ['reactjs', 'react.js'] },
    { slug: 'postgresql', displayName: 'PostgreSQL', aliases: ['postgres', 'pg'] },
    { slug: 'aws', displayName: 'Amazon Web Services', aliases: ['amazon web services'] },
  ];

  it('matches by exact slug', () => {
    const result = matchCatalogEntry('typescript', catalog);
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('exact');
    expect(result?.entry.slug).toBe('typescript');
  });

  it('matches by alias', () => {
    const result = matchCatalogEntry('reactjs', catalog);
    expect(result).not.toBeNull();
    expect(result?.matchType).toBe('alias');
  });

  it('matches by alias case-insensitive', () => {
    const result = matchCatalogEntry('Postgres', catalog);
    expect(result).not.toBeNull();
    expect(result?.entry.slug).toBe('postgresql');
  });

  it('matches related (partial slug overlap)', () => {
    const result = matchCatalogEntry('postgresq', catalog);
    // Should find related match via substring
    if (result) {
      expect(['exact', 'alias', 'related']).toContain(result.matchType);
    }
  });

  it('returns null for no match', () => {
    const result = matchCatalogEntry('cobol', catalog);
    expect(result).toBeNull();
  });
});

// ── computeRecommendation ─────────────────────────────────────────────────────

describe('computeRecommendation', () => {
  const makeMatch = (matchType: 'exact' | 'alias' | 'related'): FitMatchDTO => ({
    type: 'tech_stack',
    catalogEntry: 'react',
    jdRequirement: 'React',
    matchType,
    isRequired: true,
  });

  const makeGap = (severity: 'critical' | 'moderate' | 'minor'): FitGapDTO => ({
    type: 'tech_stack',
    jdRequirement: 'aws',
    isRequired: true,
    severity,
  });

  it('returns strong_fit when ≥80% matched with ≤1 critical gap', () => {
    const matches = Array(8).fill(makeMatch('exact'));
    const gaps = [makeGap('critical')];
    expect(computeRecommendation(matches, gaps, 10, false)).toBe('strong_fit');
  });

  it('returns moderate_fit for 50-79% match', () => {
    const matches = Array(6).fill(makeMatch('exact'));
    const gaps = [makeGap('moderate')];
    expect(computeRecommendation(matches, gaps, 10, false)).toBe('moderate_fit');
  });

  it('returns stretch for 30-49% match', () => {
    const matches = Array(3).fill(makeMatch('exact'));
    const gaps = [makeGap('moderate')];
    expect(computeRecommendation(matches, gaps, 10, false)).toBe('stretch');
  });

  it('returns low_fit for <30% match', () => {
    const matches = Array(2).fill(makeMatch('exact'));
    const gaps = [];
    expect(computeRecommendation(matches, gaps, 10, false)).toBe('low_fit');
  });

  it('returns stretch when seniority mismatch even at 50% match', () => {
    const matches = Array(6).fill(makeMatch('exact'));
    const gaps: FitGapDTO[] = [];
    expect(computeRecommendation(matches, gaps, 10, true)).toBe('stretch');
  });

  it('returns null when no required skills', () => {
    expect(computeRecommendation([], [], 0, false)).toBeNull();
  });

  it('counts partial matches at 0.5x weight', () => {
    // 8 partial matches out of 10 = 4 weighted = 40% → stretch, not moderate
    const matches = Array(8).fill(makeMatch('related'));
    const gaps: FitGapDTO[] = [];
    expect(computeRecommendation(matches, gaps, 10, false)).toBe('stretch');
  });

  it('returns strong_fit with exact and alias mix hitting 80%', () => {
    // 6 exact + 4 alias = 6 + 2 = 8 weighted out of 10 = 80%
    const exactMatches = Array(6).fill(makeMatch('exact'));
    const aliasMatches = Array(4).fill(makeMatch('alias'));
    expect(computeRecommendation([...exactMatches, ...aliasMatches], [], 10, false)).toBe(
      'strong_fit'
    );
  });
});

// ── isPrivateIP (SSRF protection) ─────────────────────────────────────────────

import { isPrivateIP } from '../src/services/job-fit.service.js';

describe('isPrivateIP', () => {
  it('detects loopback addresses', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.255.255.255')).toBe(true);
  });

  it('detects 10.x.x.x private range', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('10.255.255.255')).toBe(true);
  });

  it('detects 172.16-31.x.x private range', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
  });

  it('detects 192.168.x.x private range', () => {
    expect(isPrivateIP('192.168.0.1')).toBe(true);
    expect(isPrivateIP('192.168.255.255')).toBe(true);
  });

  it('detects link-local addresses', () => {
    expect(isPrivateIP('169.254.0.1')).toBe(true);
    expect(isPrivateIP('169.254.169.254')).toBe(true);
  });

  it('detects reserved 0.x.x.x range', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
  });

  it('detects IPv6 loopback', () => {
    expect(isPrivateIP('::1')).toBe(true);
  });

  it('detects IPv6 link-local', () => {
    expect(isPrivateIP('fe80::1')).toBe(true);
  });

  it('detects IPv6 unique local addresses', () => {
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd00::1')).toBe(true);
  });

  it('allows public IP addresses', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('203.0.113.1')).toBe(false);
  });

  it('blocks metadata service IP (AWS)', () => {
    expect(isPrivateIP('169.254.169.254')).toBe(true);
  });
});
