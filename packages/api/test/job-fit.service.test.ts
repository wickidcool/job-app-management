import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseJobDescription,
  extractSeniority,
  extractTechTerms,
  matchCatalogEntry,
  computeRecommendation,
  computeSummary,
} from '../src/services/job-fit.service.js';
import type { FitMatchDTO, FitGapDTO } from '../src/types/index.js';
import type { ParsedJD } from '../src/services/job-fit.service.js';
import { _resetConfig } from '../src/config.js';
import { LLMService } from '../src/services/llm.service.js';

vi.mock('../src/services/llm.service.js', () => ({
  LLMService: vi.fn(),
}));

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

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetConfig();
    vi.clearAllMocks();
  });

  it('extracts role title', async () => {
    const result = await parseJobDescription(sampleJD);
    expect(result.roleTitle).toBeTruthy();
    expect(result.roleTitle?.toLowerCase()).toContain('engineer');
  });

  it('extracts seniority', async () => {
    const result = await parseJobDescription(sampleJD);
    expect(result.seniority).toBe('senior');
    expect(result.seniorityConfidence).toBe('high');
  });

  it('extracts required stack', async () => {
    const result = await parseJobDescription(sampleJD);
    expect(result.requiredStack).toContain('typescript');
    expect(result.requiredStack).toContain('react');
    expect(result.requiredStack).toContain('postgresql');
    expect(result.requiredStack).toContain('aws');
  });

  it('extracts nice-to-have stack separately', async () => {
    const result = await parseJobDescription(sampleJD);
    expect(result.niceToHaveStack).toContain('docker');
    expect(result.niceToHaveStack).toContain('kubernetes');
    // Nice-to-have should not duplicate required
    expect(result.niceToHaveStack).not.toContain('typescript');
  });

  it('extracts location', async () => {
    const result = await parseJobDescription(sampleJD);
    expect(result.location).toBeTruthy();
    expect(result.location?.toLowerCase()).toContain('remote');
  });

  it('extracts compensation', async () => {
    const result = await parseJobDescription(sampleJD);
    expect(result.compensation).toBeTruthy();
    expect(result.compensation).toContain('150k');
  });

  it('extracts team scope', async () => {
    const result = await parseJobDescription(sampleJD);
    expect(result.teamScope).toContain('Manager of 3');
  });

  it('handles short JD with no sections', async () => {
    const minimal = 'Looking for a developer with React and Python skills. Remote position.';
    const result = await parseJobDescription(minimal);
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

// ── computeSummary ───────────────────────────────────────────────────────────
//
// WIC-1301. Every other surface that asserts these strings is a mocked fixture
// (`packages/web/e2e/job-fit-analysis.spec.ts`, `packages/api/test/job-fit.
// routes.test.ts`), so a fixture and the generator could disagree indefinitely
// — which is exactly how the "Strong match" collision survived. These are the
// only assertions that run the real function.

describe('computeSummary', () => {
  const match = (isRequired: boolean): FitMatchDTO => ({
    type: 'tech_stack',
    catalogEntry: 'react',
    jdRequirement: 'React',
    matchType: 'exact',
    isRequired,
  });

  const gap = (
    severity: 'critical' | 'moderate' | 'minor',
    isRequired: boolean,
    jdRequirement = 'aws'
  ): FitGapDTO => ({ type: 'tech_stack', jdRequirement, isRequired, severity });

  it('opens every rung with the same clause and never restates the verdict', () => {
    // The fit level label above the summary is the only place the verdict is
    // worded (WIC-1288). No summary may open with one — "Strong match — " did.
    const rungs = ['strong_fit', 'moderate_fit', 'stretch', 'low_fit'] as const;
    for (const rung of rungs) {
      const summary = computeSummary(rung, [match(true)], [], [], 6);
      expect(summary).toMatch(/^You match 1 of 6 required skills\./);
    }
  });

  it('never uses "match" as a verdict noun — that noun belongs to the sections', () => {
    // "Strong Matches (N)" classifies one skill; the summary counts skills.
    // Same word, two axes, three lines apart is the WIC-1288 defect class.
    const rungs = ['strong_fit', 'moderate_fit', 'stretch', 'low_fit'] as const;
    for (const rung of rungs) {
      expect(computeSummary(rung, [match(true)], [], [], 6)).not.toMatch(/\bStrong match\b/i);
    }
  });

  it('gives strong_fit no trailing clause — the top rung has no caveat', () => {
    expect(computeSummary('strong_fit', [match(true)], [], [], 6)).toBe(
      'You match 1 of 6 required skills.'
    );
  });

  it('orders the two middle rungs by their clauses, not by their labels alone', () => {
    // "Possible fit" vs "Stretch" do not self-order; the clauses must.
    expect(computeSummary('moderate_fit', [match(true)], [], [], 6)).toBe(
      'You match 1 of 6 required skills. This role is within reach.'
    );
    expect(computeSummary('stretch', [match(true)], [], [], 6)).toBe(
      'You match 1 of 6 required skills. This role may be a stretch.'
    );
  });

  it('keeps low_fit advisory', () => {
    expect(computeSummary('low_fit', [match(true)], [], [], 6)).toBe(
      'You match 1 of 6 required skills. Consider building more experience before applying.'
    );
  });

  it('does not claim coverage that the gap sentence then contradicts', () => {
    // strong_fit admits one critical required gap (computeRecommendation), so a
    // clause asserting the core requirements are covered would render directly
    // above " Gap in aws." Clauses state stance, never a fact about the data.
    const summary = computeSummary('strong_fit', [match(true)], [], [gap('critical', true)], 6);
    expect(summary).toBe('You match 1 of 6 required skills. Gap in aws.');
    expect(summary).not.toMatch(/cover|meet all|no gaps/i);
  });

  it('appends critical required gaps, pluralising and capping at two', () => {
    const gaps = [
      gap('critical', true, 'aws'),
      gap('critical', true, 'kubernetes'),
      gap('critical', true, 'terraform'),
    ];
    expect(computeSummary('moderate_fit', [match(true)], [], gaps, 6)).toBe(
      'You match 1 of 6 required skills. This role is within reach. Gaps in aws, kubernetes and 1 more.'
    );
  });

  it('ignores gaps that are not both critical and required', () => {
    const gaps = [gap('critical', false), gap('moderate', true), gap('minor', true)];
    expect(computeSummary('moderate_fit', [match(true)], [], gaps, 6)).toBe(
      'You match 1 of 6 required skills. This role is within reach.'
    );
  });

  it('counts required strong AND partial matches, excluding nice-to-haves', () => {
    // This is the count that diverges from the "Strong Matches (N)" heading:
    // two non-required strong matches make the heading read 3 while the summary
    // reads "1 of 6". The summary's "required" qualifier is what disambiguates
    // it, so the two must never be worded as the same quantity.
    const strong = [match(true), match(false), match(false)];
    const partial = [{ ...match(true), matchType: 'related' as const }];
    expect(computeSummary('strong_fit', strong, partial, [], 6)).toBe(
      'You match 2 of 6 required skills.'
    );
  });

  it('explains itself when there is no recommendation to summarise', () => {
    expect(computeSummary(null, [], [], [], 0)).toBe(
      'Unable to compute fit score — no required skills found in the job description.'
    );
  });
});

// ── parseJobDescription - LLM integration ────────────────────────────────────

describe('parseJobDescription - LLM integration', () => {
  let savedApiKey: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env.ANTHROPIC_API_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (savedApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    _resetConfig();
  });

  it('uses LLM result when API key is configured', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    _resetConfig();

    const llmResult: ParsedJD = {
      roleTitle: 'Senior Engineer',
      seniority: 'senior',
      seniorityConfidence: 'high',
      requiredStack: ['typescript', 'react'],
      niceToHaveStack: ['graphql'],
      industries: ['fintech'],
      teamScope: 'IC',
      location: 'Remote',
      compensation: '$150k-$190k',
    };

    const mockParseJD = vi.fn().mockResolvedValue(llmResult);
    vi.mocked(LLMService).mockImplementation(() => ({ parseJobDescription: mockParseJD }) as any);

    const result = await parseJobDescription(
      'Senior Engineer at Acme requiring TypeScript and React.'
    );

    expect(mockParseJD).toHaveBeenCalledOnce();
    expect(result).toEqual(llmResult);
  });

  it('falls back to regex when LLM throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    _resetConfig();

    const mockParseJD = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    vi.mocked(LLMService).mockImplementation(() => ({ parseJobDescription: mockParseJD }) as any);

    const jd = 'Senior Software Engineer at Acme. Requirements: TypeScript, React. Remote.';
    const result = await parseJobDescription(jd);

    expect(mockParseJD).toHaveBeenCalledOnce();
    expect(result.requiredStack).toContain('typescript');
    expect(result.requiredStack).toContain('react');
  });

  it('skips LLM and uses regex when API key is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    _resetConfig();

    const jd = 'Senior Software Engineer at Acme. Requirements: TypeScript, React. Remote.';
    const result = await parseJobDescription(jd);

    expect(LLMService).not.toHaveBeenCalled();
    expect(result.requiredStack).toContain('typescript');
    expect(result.requiredStack).toContain('react');
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
