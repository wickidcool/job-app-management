import { desc } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { techStackTags, jobFitTags, quantifiedBullets } from '../db/schema.js';
import {
  AppError,
  JobFitInputError,
  JobFitUrlFetchError,
  RateLimitError,
} from '../types/index.js';
import type {
  AnalyzeJobFitInput,
  AnalyzeJobFitResponse,
  ParsedJobDescriptionDTO,
  FitMatchDTO,
  FitGapDTO,
  RecommendedStarEntryDTO,
  Seniority,
  Confidence,
  FitRecommendation,
} from '../types/index.js';

// ── Rate limiting ────────────────────────────────────────────────────────────

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

const textBucket: RateLimitBucket = { count: 0, windowStart: Date.now() };
const urlBucket: RateLimitBucket = { count: 0, windowStart: Date.now() };

const TEXT_LIMIT = 30;
const URL_LIMIT = 10;
const WINDOW_MS = 60_000;

export function checkRateLimit(
  bucket: RateLimitBucket,
  limit: number,
): { remaining: number; reset: number } {
  const now = Date.now();
  if (now - bucket.windowStart > WINDOW_MS) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count++;
  const reset = Math.ceil((bucket.windowStart + WINDOW_MS) / 1000);
  if (bucket.count > limit) {
    throw new RateLimitError(reset);
  }
  return { remaining: limit - bucket.count, reset };
}

// Exported for testing
export const _buckets = { text: textBucket, url: urlBucket };

// ── URL fetching ─────────────────────────────────────────────────────────────

export async function fetchJobDescriptionFromUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobFitAnalyzer/1.0)' },
    });

    if (!response.ok) {
      throw new JobFitUrlFetchError(url, response.status);
    }

    const html = await response.text();
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if ((error as Error).name === 'AbortError') {
      throw new AppError('URL_FETCH_TIMEOUT', 'URL fetch exceeded 10 second timeout', { url }, 422);
    }
    throw new JobFitUrlFetchError(url);
  } finally {
    clearTimeout(timeout);
  }
}

// ── JD parsing ───────────────────────────────────────────────────────────────

const SENIORITY_PATTERNS: Array<{
  pattern: RegExp;
  seniority: Seniority;
  confidence: Confidence;
}> = [
  {
    pattern: /\bc[- ]?level\b|chief\s+\w+\s+officer|\bcto\b|\bceo\b|\bcpo\b|\bcso\b/i,
    seniority: 'c_level',
    confidence: 'high',
  },
  { pattern: /\bvice\s+president\b|\bvp\s+of\b|\bvp\b/i, seniority: 'vp', confidence: 'high' },
  { pattern: /\bdirector\b/i, seniority: 'director', confidence: 'high' },
  { pattern: /\bprincipal\b/i, seniority: 'principal', confidence: 'high' },
  {
    pattern: /\bstaff\s+(?:engineer|developer|software)\b/i,
    seniority: 'staff',
    confidence: 'high',
  },
  { pattern: /\bsenior\b|\bsr\.?\s/i, seniority: 'senior', confidence: 'high' },
  { pattern: /\bjunior\b|\bjr\.?\s/i, seniority: 'entry', confidence: 'high' },
  {
    pattern: /\bmid[- ]level\b|\blevel\s+ii\b/i,
    seniority: 'mid',
    confidence: 'medium',
  },
  {
    pattern: /\bentry[- ]level\b|\bassociate\s+(?:engineer|developer)\b/i,
    seniority: 'entry',
    confidence: 'medium',
  },
];

// Known tech terms: slug -> aliases to match in JD text
const TECH_TERMS: Record<string, string[]> = {
  typescript: ['typescript', ' ts '],
  javascript: ['javascript', ' js '],
  python: ['python'],
  java: [' java '],
  kotlin: ['kotlin'],
  swift: ['swift'],
  go: ['golang', 'go lang', ' go '],
  rust: ['rust'],
  ruby: ['ruby'],
  php: ['php'],
  'c-sharp': ['c#', 'csharp', 'c sharp'],
  cpp: ['c++', 'cpp'],
  react: ['react'],
  vue: ['vue.js', 'vuejs', ' vue '],
  angular: ['angular'],
  svelte: ['svelte'],
  nextjs: ['next.js', 'nextjs'],
  tailwind: ['tailwind'],
  nodejs: ['node.js', 'nodejs', 'node js'],
  express: ['express'],
  fastify: ['fastify'],
  nestjs: ['nestjs', 'nest.js'],
  django: ['django'],
  flask: ['flask'],
  fastapi: ['fastapi'],
  rails: ['ruby on rails', ' rails '],
  spring: ['spring boot', 'spring framework'],
  graphql: ['graphql'],
  postgresql: ['postgresql', 'postgres'],
  mysql: ['mysql'],
  mongodb: ['mongodb', 'mongo'],
  redis: ['redis'],
  elasticsearch: ['elasticsearch'],
  dynamodb: ['dynamodb'],
  sqlite: ['sqlite'],
  aws: ['amazon web services', ' aws '],
  gcp: ['google cloud platform', 'google cloud', ' gcp '],
  azure: ['microsoft azure', ' azure '],
  docker: ['docker'],
  kubernetes: ['kubernetes', 'k8s'],
  terraform: ['terraform'],
  'github-actions': ['github actions'],
  jenkins: ['jenkins'],
  tensorflow: ['tensorflow'],
  pytorch: ['pytorch'],
};

function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function extractTechTerms(text: string): string[] {
  const padded = ` ${text.toLowerCase()} `;
  const found = new Set<string>();

  for (const [slug, aliases] of Object.entries(TECH_TERMS)) {
    for (const alias of aliases) {
      if (padded.includes(alias.toLowerCase())) {
        found.add(slug);
        break;
      }
    }
  }

  return Array.from(found);
}

export function extractSeniority(text: string): {
  seniority: Seniority | null;
  confidence: Confidence;
} {
  for (const { pattern, seniority, confidence } of SENIORITY_PATTERNS) {
    if (pattern.test(text)) {
      return { seniority, confidence };
    }
  }
  return { seniority: null, confidence: 'low' };
}

function extractRoleTitle(text: string): string | null {
  const titleSection = text.slice(0, 600);
  const patterns = [
    /^([^\n]{5,80}(?:engineer|developer|architect|manager|designer|analyst|scientist|lead|director|vp|officer)[^\n]*)/im,
    /(?:position|role|title|job title):\s*([^\n]{5,80})/i,
  ];

  for (const p of patterns) {
    const match = titleSection.match(p);
    if (match) return match[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

// Known section delimiters used to bound section extraction
const KNOWN_SECTION_DELIMITERS = [
  'requirements',
  'must have',
  'qualifications',
  'what you bring',
  'you will need',
  'minimum qualifications',
  'basic qualifications',
  'nice to have',
  'preferred',
  'bonus',
  'responsibilities',
  'about you',
  'benefits',
  'about us',
  'about the role',
  'what you will do',
  "what you'll do",
  'compensation',
  'how to apply',
];

function extractSection(text: string, headers: string[]): string {
  const lower = text.toLowerCase();
  let result = '';

  for (const header of headers) {
    const idx = lower.indexOf(header);
    if (idx === -1) continue;

    const contentStart = idx + header.length;
    let endIdx = Math.min(contentStart + 1200, text.length);

    // Stop at the next known section delimiter that isn't one of our headers
    for (const delimiter of KNOWN_SECTION_DELIMITERS) {
      if (headers.includes(delimiter)) continue;
      const delimIdx = lower.indexOf(delimiter, contentStart);
      if (delimIdx !== -1 && delimIdx < endIdx) {
        endIdx = delimIdx;
      }
    }

    result += text.slice(idx, endIdx) + ' ';
  }

  return result;
}

function extractLocation(text: string): string | null {
  const patterns = [
    /(?:location|based in|office location):\s*([^\n,;]{5,60})/i,
    /\b(remote(?:\s+\([^)]{2,30}\))?)\b/i,
    /\b(on[- ]?site|hybrid)\b/i,
  ];

  for (const p of patterns) {
    const match = text.match(p);
    if (match) return match[1].trim();
  }
  return null;
}

function extractCompensation(text: string): string | null {
  const patterns = [
    /\$[\d,]+k?\s*[-–]\s*\$[\d,]+k?(?:\s*\+?\s*equity)?/i,
    /(?:salary|compensation|pay range):\s*([^\n]{5,60})/i,
  ];

  for (const p of patterns) {
    const match = text.match(p);
    if (match) return (match[1] ?? match[0]).trim();
  }
  return null;
}

function extractTeamScope(text: string): string | null {
  const managerPattern =
    /manag(?:e|ing|es|ed)\s+(?:a\s+team\s+of\s+)?(\d+\+?)\s+(?:engineers?|developers?|people|reports?|ics?)/i;
  const managerMatch = text.match(managerPattern);
  if (managerMatch) return `Manager of ${managerMatch[1]}`;

  if (/\bindividual\s+contributor\b|\bic\b/i.test(text)) return 'IC';
  if (/\bcross[- ]functional\b/i.test(text)) return 'Cross-functional';
  if (/\btech(?:nical)?\s+lead\b|\bteam\s+lead\b/i.test(text)) return 'Tech Lead';

  return null;
}

export interface ParsedJD {
  roleTitle: string | null;
  seniority: Seniority | null;
  seniorityConfidence: Confidence;
  requiredStack: string[];
  niceToHaveStack: string[];
  industries: string[];
  teamScope: string | null;
  location: string | null;
  compensation: string | null;
}

export function parseJobDescription(text: string): ParsedJD {
  const roleTitle = extractRoleTitle(text);
  const { seniority, confidence: seniorityConfidence } = extractSeniority(text);

  const requiredSection = extractSection(text, [
    'requirements',
    'required',
    'must have',
    'you must',
    'qualifications',
    'what you bring',
    'you will need',
    'minimum qualifications',
    'basic qualifications',
  ]);

  const niceToHaveSection = extractSection(text, [
    'nice to have',
    'preferred',
    'bonus',
    'would be great',
    'extra points',
    'not required but',
  ]);

  const requiredText = requiredSection || text;
  const requiredStack = extractTechTerms(requiredText);
  const niceToHaveStack = extractTechTerms(niceToHaveSection).filter(
    (t) => !requiredStack.includes(t),
  );

  return {
    roleTitle,
    seniority,
    seniorityConfidence,
    requiredStack,
    niceToHaveStack,
    industries: [],
    teamScope: extractTeamScope(text),
    location: extractLocation(text),
    compensation: extractCompensation(text),
  };
}

// ── Catalog matching ─────────────────────────────────────────────────────────

interface CatalogEntry {
  slug: string;
  displayName: string;
  aliases: string[];
}

export function matchCatalogEntry(
  jdTerm: string,
  catalog: CatalogEntry[],
): { entry: CatalogEntry; matchType: 'exact' | 'alias' | 'related' } | null {
  const normalized = normalizeSlug(jdTerm);

  for (const entry of catalog) {
    if (entry.slug === normalized || normalizeSlug(entry.displayName) === normalized) {
      return { entry, matchType: 'exact' };
    }
  }

  for (const entry of catalog) {
    if (
      entry.aliases.some(
        (a) => normalizeSlug(a) === normalized || a.toLowerCase() === jdTerm.toLowerCase(),
      )
    ) {
      return { entry, matchType: 'alias' };
    }
  }

  for (const entry of catalog) {
    const entryNorm = normalizeSlug(entry.displayName);
    if (
      (normalized.length >= 3 && entryNorm.includes(normalized)) ||
      (entryNorm.length >= 3 && normalized.includes(entryNorm))
    ) {
      return { entry, matchType: 'related' };
    }
  }

  return null;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export function computeRecommendation(
  requiredMatches: FitMatchDTO[],
  requiredGaps: FitGapDTO[],
  totalRequired: number,
  hasSeniorityMismatch: boolean,
): FitRecommendation | null {
  if (totalRequired === 0) return null;

  const exactCount = requiredMatches.filter((m) => m.matchType === 'exact').length;
  const partialCount = requiredMatches.filter((m) => m.matchType !== 'exact').length;
  const weightedMatches = exactCount + partialCount * 0.5;
  const matchPct = weightedMatches / totalRequired;
  const criticalGaps = requiredGaps.filter((g) => g.severity === 'critical').length;

  if (matchPct >= 0.8 && criticalGaps <= 1) return 'strong_fit';
  if (matchPct >= 0.5 && criticalGaps <= 3 && !hasSeniorityMismatch) return 'moderate_fit';
  if (matchPct >= 0.3 || hasSeniorityMismatch) return 'stretch';
  return 'low_fit';
}

function computeSummary(
  recommendation: FitRecommendation | null,
  strongMatches: FitMatchDTO[],
  gaps: FitGapDTO[],
  totalRequired: number,
): string {
  if (!recommendation)
    return 'Unable to compute fit score — no required skills found in the job description.';

  const matchCount = strongMatches.filter((m) => m.isRequired && m.type === 'tech_stack').length;
  const critGaps = gaps.filter((g) => g.severity === 'critical' && g.isRequired);
  const gapStr =
    critGaps.length > 0
      ? ` Gap${critGaps.length > 1 ? 's' : ''} in ${critGaps
          .slice(0, 2)
          .map((g) => g.jdRequirement)
          .join(', ')}${critGaps.length > 2 ? ` and ${critGaps.length - 2} more` : ''}.`
      : '';

  switch (recommendation) {
    case 'strong_fit':
      return `Strong match — you meet ${matchCount} of ${totalRequired} required skills.${gapStr}`;
    case 'moderate_fit':
      return `You match ${matchCount} of ${totalRequired} required skills.${gapStr}`;
    case 'stretch':
      return `You match ${matchCount} of ${totalRequired} required skills. This role may be a stretch.${gapStr}`;
    case 'low_fit':
      return `You match ${matchCount} of ${totalRequired} required skills. Consider building more experience before applying.${gapStr}`;
  }
}

function gapSeverity(jdTerm: string, isRequired: boolean): 'critical' | 'moderate' | 'minor' {
  if (!isRequired) return 'minor';
  if (/cloud|aws|gcp|azure|kubernetes|security|compliance/i.test(jdTerm)) return 'critical';
  return 'moderate';
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function analyzeJobFit(input: AnalyzeJobFitInput): Promise<{
  response: AnalyzeJobFitResponse;
  rateLimitHeaders: { remaining: number; reset: number };
}> {
  const hasText = input.jobDescriptionText !== undefined;
  const hasUrl = input.jobDescriptionUrl !== undefined;

  if (!hasText && !hasUrl) {
    throw new JobFitInputError(
      'JD_INPUT_REQUIRED',
      'Either jobDescriptionText or jobDescriptionUrl is required',
    );
  }
  if (hasText && hasUrl) {
    throw new JobFitInputError(
      'JD_INPUT_CONFLICT',
      'Provide either jobDescriptionText or jobDescriptionUrl, not both',
    );
  }

  let jdText: string;
  let rateLimitHeaders: { remaining: number; reset: number };

  if (hasText) {
    const text = input.jobDescriptionText!;
    if (text.length < 50)
      throw new JobFitInputError(
        'JD_TEXT_TOO_SHORT',
        'jobDescriptionText must be at least 50 characters',
      );
    if (text.length > 50_000)
      throw new JobFitInputError(
        'JD_TEXT_TOO_LONG',
        'jobDescriptionText must not exceed 50,000 characters',
      );
    rateLimitHeaders = checkRateLimit(textBucket, TEXT_LIMIT);
    jdText = text;
  } else {
    const url = input.jobDescriptionUrl!;
    try {
      new URL(url);
    } catch {
      throw new JobFitInputError('JD_URL_INVALID', 'jobDescriptionUrl is not a valid URL');
    }
    rateLimitHeaders = checkRateLimit(urlBucket, URL_LIMIT);
    jdText = await fetchJobDescriptionFromUrl(url);
  }

  const parsed = parseJobDescription(jdText);

  const db = getDb();
  const [techTags, jfTags, bullets] = await Promise.all([
    db.select().from(techStackTags).orderBy(desc(techStackTags.mentionCount)),
    db.select().from(jobFitTags).orderBy(desc(jobFitTags.mentionCount)),
    db.select().from(quantifiedBullets),
  ]);

  const catalogEmpty = techTags.length === 0 && jfTags.length === 0;

  const parsedJd: ParsedJobDescriptionDTO = {
    roleTitle: parsed.roleTitle,
    seniority: parsed.seniority,
    seniorityConfidence: parsed.seniorityConfidence,
    requiredStack: parsed.requiredStack,
    niceToHaveStack: parsed.niceToHaveStack,
    industries: parsed.industries,
    teamScope: parsed.teamScope,
    location: parsed.location,
    compensation: parsed.compensation,
  };

  if (catalogEmpty) {
    return {
      response: {
        recommendation: null,
        summary:
          'Your catalog is empty. Upload a resume or add application history to enable fit analysis.',
        confidence: 'high',
        parsedJd,
        strongMatches: [],
        partialMatches: [],
        gaps: [],
        recommendedStarEntries: [],
        catalogEmpty: true,
        analysisTimestamp: new Date().toISOString(),
      },
      rateLimitHeaders,
    };
  }

  const techCatalog: CatalogEntry[] = techTags.map((t) => ({
    slug: t.tagSlug,
    displayName: t.displayName,
    aliases: t.aliases ?? [],
  }));
  const jfCatalog: CatalogEntry[] = jfTags.map((t) => ({
    slug: t.tagSlug,
    displayName: t.displayName,
    aliases: t.aliases ?? [],
  }));

  const strongMatches: FitMatchDTO[] = [];
  const partialMatches: FitMatchDTO[] = [];
  const gaps: FitGapDTO[] = [];

  for (const term of parsed.requiredStack) {
    const match = matchCatalogEntry(term, techCatalog);
    if (match) {
      const fitMatch: FitMatchDTO = {
        type: 'tech_stack',
        catalogEntry: match.entry.slug,
        jdRequirement: term,
        matchType: match.matchType,
        isRequired: true,
      };
      if (match.matchType === 'exact') strongMatches.push(fitMatch);
      else partialMatches.push(fitMatch);
    } else {
      gaps.push({
        type: 'tech_stack',
        jdRequirement: term,
        isRequired: true,
        severity: gapSeverity(term, true),
      });
    }
  }

  for (const term of parsed.niceToHaveStack) {
    const match = matchCatalogEntry(term, techCatalog);
    if (match) {
      const fitMatch: FitMatchDTO = {
        type: 'tech_stack',
        catalogEntry: match.entry.slug,
        jdRequirement: term,
        matchType: match.matchType,
        isRequired: false,
      };
      if (match.matchType === 'exact') strongMatches.push(fitMatch);
      else partialMatches.push(fitMatch);
    } else {
      gaps.push({ type: 'tech_stack', jdRequirement: term, isRequired: false, severity: 'minor' });
    }
  }

  let hasSeniorityMismatch = false;
  if (parsed.seniority) {
    const seniorityMatch = matchCatalogEntry(parsed.seniority, jfCatalog);
    if (seniorityMatch) {
      strongMatches.push({
        type: 'seniority',
        catalogEntry: seniorityMatch.entry.slug,
        jdRequirement: parsed.roleTitle ?? parsed.seniority,
        matchType: seniorityMatch.matchType,
        isRequired: true,
      });
    } else {
      hasSeniorityMismatch = true;
      gaps.push({
        type: 'seniority',
        jdRequirement: parsed.seniority,
        isRequired: true,
        severity: 'moderate',
      });
    }
  }

  for (const industry of parsed.industries) {
    const match = matchCatalogEntry(industry, jfCatalog);
    if (match) {
      const fitMatch: FitMatchDTO = {
        type: 'job_fit',
        catalogEntry: match.entry.slug,
        jdRequirement: industry,
        matchType: match.matchType,
        isRequired: false,
      };
      if (match.matchType === 'exact') strongMatches.push(fitMatch);
      else partialMatches.push(fitMatch);
    }
  }

  const totalRequired = parsed.requiredStack.length;
  const requiredTechMatches = [
    ...strongMatches.filter((m) => m.isRequired && m.type === 'tech_stack'),
    ...partialMatches.filter((m) => m.isRequired && m.type === 'tech_stack'),
  ];
  const requiredGaps = gaps.filter((g) => g.isRequired && g.type === 'tech_stack');

  const recommendation = computeRecommendation(
    requiredTechMatches,
    requiredGaps,
    totalRequired,
    hasSeniorityMismatch,
  );

  const confidence: Confidence =
    parsed.requiredStack.length > 3 ? 'high' : parsed.requiredStack.length > 0 ? 'medium' : 'low';

  const recommendedStarEntries: RecommendedStarEntryDTO[] = bullets
    .map((b) => {
      const matchedTerms = parsed.requiredStack.filter((term) =>
        b.rawText.toLowerCase().includes(term.toLowerCase()),
      );
      const relevanceScore =
        totalRequired > 0 ? Math.min(1, matchedTerms.length / totalRequired) : 0;
      return { bullet: b, relevanceScore };
    })
    .filter(({ relevanceScore }) => relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5)
    .map(({ bullet, relevanceScore }) => ({
      id: bullet.id,
      rawText: bullet.rawText,
      impactCategory: bullet.impactCategory,
      relevanceScore: Math.round(relevanceScore * 100) / 100,
    }));

  return {
    response: {
      recommendation,
      summary: computeSummary(recommendation, strongMatches, gaps, totalRequired),
      confidence,
      parsedJd,
      strongMatches,
      partialMatches,
      gaps,
      recommendedStarEntries,
      catalogEmpty: false,
      analysisTimestamp: new Date().toISOString(),
    },
    rateLimitHeaders,
  };
}
