import { and, desc, eq, isNull } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { lookup } from 'node:dns/promises';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import {
  applications,
  techStackTags,
  jobFitTags,
  jobFitAnalyses,
  quantifiedBullets,
  type JobFitAnalysis,
} from '../db/schema.js';
import { AppError, JobFitInputError, JobFitUrlFetchError, RateLimitError } from '../types/index.js';
import { getConfig } from '../config.js';
import { LLMService } from './llm.service.js';
import type {
  AnalyzeJobFitInput,
  AnalyzeJobFitResponse,
  JobFitAnalysisSummaryDTO,
  ListJobFitAnalysesParams,
  ListJobFitAnalysesResponse,
  ParsedJobDescriptionDTO,
  FitMatchDTO,
  FitGapDTO,
  RecommendedStarEntryDTO,
  Seniority,
  Confidence,
  FitRecommendation,
} from '../types/index.js';

// ── Rate limiting (per-IP) ───────────────────────────────────────────────────

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

const TEXT_LIMIT = 30;
const URL_LIMIT = 10;
const WINDOW_MS = 60_000;

const textBuckets = new Map<string, RateLimitBucket>();
const urlBuckets = new Map<string, RateLimitBucket>();

function cleanupStaleBuckets(buckets: Map<string, RateLimitBucket>): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS * 2) {
      buckets.delete(key);
    }
  }
}

function getBucket(buckets: Map<string, RateLimitBucket>, clientId: string): RateLimitBucket {
  let bucket = buckets.get(clientId);
  if (!bucket) {
    bucket = { count: 0, windowStart: Date.now() };
    buckets.set(clientId, bucket);
  }
  return bucket;
}

export function checkRateLimit(
  buckets: Map<string, RateLimitBucket>,
  clientId: string,
  limit: number
): { remaining: number; reset: number } {
  cleanupStaleBuckets(buckets);
  const bucket = getBucket(buckets, clientId);
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

/** @internal Exported for testing only */
export const _rateLimitState = { textBuckets, urlBuckets, TEXT_LIMIT, URL_LIMIT };

// ── SSRF Protection ──────────────────────────────────────────────────────────

const PRIVATE_CIDR_RANGES = [
  { prefix: '127.', label: 'loopback' },
  { prefix: '10.', label: 'private' },
  { prefix: '172.16.', label: 'private' },
  { prefix: '172.17.', label: 'private' },
  { prefix: '172.18.', label: 'private' },
  { prefix: '172.19.', label: 'private' },
  { prefix: '172.20.', label: 'private' },
  { prefix: '172.21.', label: 'private' },
  { prefix: '172.22.', label: 'private' },
  { prefix: '172.23.', label: 'private' },
  { prefix: '172.24.', label: 'private' },
  { prefix: '172.25.', label: 'private' },
  { prefix: '172.26.', label: 'private' },
  { prefix: '172.27.', label: 'private' },
  { prefix: '172.28.', label: 'private' },
  { prefix: '172.29.', label: 'private' },
  { prefix: '172.30.', label: 'private' },
  { prefix: '172.31.', label: 'private' },
  { prefix: '192.168.', label: 'private' },
  { prefix: '169.254.', label: 'link-local' },
  { prefix: '0.', label: 'reserved' },
];

/** @internal Exported for testing only */
export function isPrivateIP(ip: string): boolean {
  for (const { prefix } of PRIVATE_CIDR_RANGES) {
    if (ip.startsWith(prefix)) return true;
  }
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }
  return false;
}

async function validateUrlForSSRF(url: string): Promise<void> {
  const parsed = new URL(url);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new JobFitInputError(
      'JD_URL_INVALID_SCHEME',
      'Only http:// and https:// URLs are allowed'
    );
  }

  if (parsed.port && !['80', '443', ''].includes(parsed.port)) {
    throw new JobFitInputError('JD_URL_INVALID_PORT', 'Non-standard ports are not allowed');
  }

  const hostname = parsed.hostname;
  if (!hostname || hostname === 'localhost') {
    throw new JobFitInputError('JD_URL_BLOCKED', 'localhost URLs are not allowed');
  }

  const ipMatch = hostname.match(/^(\d+\.\d+\.\d+\.\d+)$/);
  if (ipMatch) {
    if (isPrivateIP(ipMatch[1])) {
      throw new JobFitInputError('JD_URL_BLOCKED', 'Private/internal IP addresses are not allowed');
    }
    return;
  }

  try {
    const { address } = await lookup(hostname);
    if (isPrivateIP(address)) {
      throw new JobFitInputError('JD_URL_BLOCKED', 'URL resolves to private/internal IP address');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new JobFitInputError('JD_URL_DNS_FAILED', `Failed to resolve hostname: ${hostname}`);
  }
}

// ── URL fetching ─────────────────────────────────────────────────────────────

export async function fetchJobDescriptionFromUrl(url: string): Promise<string> {
  await validateUrlForSSRF(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobFitAnalyzer/1.0)' },
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        const redirectUrl = new URL(location, url).href;
        await validateUrlForSSRF(redirectUrl);
        return fetchJobDescriptionFromUrl(redirectUrl);
      }
      throw new JobFitUrlFetchError(url, response.status);
    }

    if (!response.ok) {
      throw new JobFitUrlFetchError(url, response.status);
    }

    const html = await response.text();
    return html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
  'the skillset',
  'skillset',
  'skills',
  'the opportunity',
];

function findSectionHeaderIndex(text: string, header: string): number {
  const lower = text.toLowerCase();
  const headerLower = header.toLowerCase();
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:[#*]+\\s*)?(?:\\*\\*)?${headerLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\*\\*)?\\s*[:.]?\\s*(?:\\n|$)`,
    'im'
  );
  const match = lower.match(pattern);
  if (match && match.index !== undefined) {
    const matchStart = match.index;
    return lower.indexOf(headerLower, matchStart);
  }
  return -1;
}

function extractSection(text: string, headers: string[]): string {
  const lower = text.toLowerCase();
  let result = '';

  for (const header of headers) {
    const idx = findSectionHeaderIndex(text, header);
    if (idx === -1) continue;

    const contentStart = idx + header.length;
    let endIdx = Math.min(contentStart + 1200, text.length);

    for (const delimiter of KNOWN_SECTION_DELIMITERS) {
      if (headers.includes(delimiter)) continue;
      const delimIdx = findSectionHeaderIndex(text.slice(contentStart), delimiter);
      if (delimIdx !== -1 && contentStart + delimIdx < endIdx) {
        endIdx = contentStart + delimIdx;
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

function parseJobDescriptionRegex(text: string): ParsedJD {
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
    'the skillset',
    'skillset',
    'skills',
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
    (t) => !requiredStack.includes(t)
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

export async function parseJobDescription(text: string): Promise<ParsedJD> {
  const config = getConfig();
  if (config.anthropicApiKey) {
    try {
      const llm = new LLMService();
      return await llm.parseJobDescription(text);
    } catch (err) {
      console.warn(
        `[job-fit] LLM parsing failed, falling back to regex: ${(err as Error).message}`
      );
    }
  }
  return parseJobDescriptionRegex(text);
}

// ── Catalog matching ─────────────────────────────────────────────────────────

interface CatalogEntry {
  slug: string;
  displayName: string;
  aliases: string[];
}

export function matchCatalogEntry(
  jdTerm: string,
  catalog: CatalogEntry[]
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
        (a) => normalizeSlug(a) === normalized || a.toLowerCase() === jdTerm.toLowerCase()
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

/**
 * The weighted required-skill match, as a fraction in `[0, 1]`.
 *
 * This is the first of the three variables the `recommendation` cascade is
 * ordered over, and it is also the number `AnalyzeJobFitResponse.fitScore`
 * publishes as a percentage (WIC-1652). It is extracted rather than duplicated
 * for exactly that reason: a separately-written "match percent" would be free to
 * disagree with the tier printed beside it, which is the class of defect
 * WIC-1309 already cost this endpoint once.
 *
 * `null` for `totalRequired === 0` — the job description named no required
 * skills, so there is no denominator and no score. That is the same condition
 * under which `computeRecommendation` returns `null`, which is what keeps
 * `fitScore === null` and `recommendation === null` in lockstep.
 */
export function computeMatchFraction(
  requiredMatches: FitMatchDTO[],
  totalRequired: number
): number | null {
  if (totalRequired === 0) return null;
  const exactCount = requiredMatches.filter((m) => m.matchType === 'exact').length;
  const partialCount = requiredMatches.filter((m) => m.matchType !== 'exact').length;
  return (exactCount + partialCount * 0.5) / totalRequired;
}

/** `computeMatchFraction` as the 0-100 integer the wire and the DB carry. */
export function computeFitScore(
  requiredMatches: FitMatchDTO[],
  totalRequired: number
): number | null {
  const fraction = computeMatchFraction(requiredMatches, totalRequired);
  return fraction === null ? null : Math.round(fraction * 100);
}

export function computeRecommendation(
  requiredMatches: FitMatchDTO[],
  requiredGaps: FitGapDTO[],
  totalRequired: number,
  hasSeniorityMismatch: boolean
): FitRecommendation | null {
  const matchPct = computeMatchFraction(requiredMatches, totalRequired);
  if (matchPct === null) return null;

  const criticalGaps = requiredGaps.filter((g) => g.severity === 'critical').length;

  if (matchPct >= 0.8 && criticalGaps <= 1) return 'strong_fit';
  if (matchPct >= 0.5 && criticalGaps <= 3 && !hasSeniorityMismatch) return 'moderate_fit';
  if (matchPct >= 0.3 || hasSeniorityMismatch) return 'stretch';
  return 'low_fit';
}

/**
 * The sentence rendered directly beneath the fit level on `JobFitAnalysis`.
 *
 * Two vocabulary rules bind this function, both decided in WIC-1301 and
 * specified in `docs/design/DESIGN_SYSTEM.md` ("Fit Level Summary"):
 *
 * 1. **The summary never restates the verdict.** The fit level label above it
 *    (`FIT_LEVEL_LABELS`, WIC-1288) is the only place the verdict is worded.
 *    `strong_fit` used to open "Strong match — ", which both duplicated the
 *    "Strong fit" label three lines above it *and* borrowed "match", the noun
 *    the per-skill sections own ("Strong Matches (N)"), to mean something else:
 *    a whole-application verdict rather than one skill's `matchType`. The two
 *    also carry different numbers — `matchCount` counts required strong *and*
 *    partial matches, while the heading counts every strong match including
 *    nice-to-haves — so "Strong match — you meet 5 of 6" could sit above
 *    "Strong Matches (7)". The e2e fixture happened to make them agree, which
 *    is what kept it invisible. **The verdict axis owns "fit"; the match
 *    classification axis owns "match".** Here, "match" is only ever the verb
 *    counting skills, which is the same axis the sections use.
 *
 * 2. **The trailing clause is a caveat, so the top rung has none.** The ladder
 *    reads: nothing to add / within reach / a stretch / not yet. `moderate_fit`
 *    previously had no clause at all, which left the ladder's weakest joint —
 *    "Possible fit" vs "Stretch" — to be ordered by two labels that do not
 *    reliably order themselves ("possible" is the weakest modality word in
 *    English; "a stretch role" is idiomatically aspirational).
 *
 * A clause may not assert coverage the gap sentence then contradicts.
 * `strong_fit` admits one critical required gap (`computeRecommendation`), so
 * "your profile covers the core requirements" would render immediately above
 * " Gap in AWS." Clauses state the verdict's stance, never a fact about the
 * data — which is also why they stay true when `gaps` is empty.
 *
 * Magnitude adjectives are unavailable here: gap severity owns
 * `critical`/`moderate`/`minor` and confidence owns `high`/`medium`/`low`
 * (DESIGN_SYSTEM.md → "Scale Vocabulary").
 *
 * Exported for unit testing — every other surface that asserts these strings
 * is a mocked fixture, which is precisely how the collision above survived.
 */
export function computeSummary(
  recommendation: FitRecommendation | null,
  strongMatches: FitMatchDTO[],
  partialMatches: FitMatchDTO[],
  gaps: FitGapDTO[],
  totalRequired: number
): string {
  if (!recommendation)
    return 'Unable to compute fit score — no required skills found in the job description.';

  const requiredMatches = [...strongMatches, ...partialMatches].filter((m) => m.isRequired);
  const matchCount = requiredMatches.length;
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
      return `You match ${matchCount} of ${totalRequired} required skills.${gapStr}`;
    case 'moderate_fit':
      return `You match ${matchCount} of ${totalRequired} required skills. This role is within reach.${gapStr}`;
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

// ── Tenancy ───────────────────────────────────────────────────────────────────

/**
 * Owner predicates for the three catalog tables this endpoint reads (WIC-1435) —
 * mirror of `bulletOwnerScope` in `interviewPrep.service.ts` / `resume-variant.
 * service.ts` (WIC-1449). Unscoped, the analysis was computed over the union of
 * every user's catalog and returned other users' `rawText` — the user-authored
 * accomplishment sentence, which names employers and metrics — verbatim in
 * `recommendedStarEntries`. RLS does not backstop it: the Worker is not the
 * `authenticated` role and never sets a JWT claim, so `auth.uid()` is NULL and
 * `0002_rls_current_schema.sql`'s policies never apply.
 *
 * Never `undefined` — an absent caller id scopes to `IS NULL` rather than failing
 * open to the whole table. All three columns are `user_id uuid NOT NULL`
 * (`schema.ts:221`, `:243`, `:265`), so unlike the nullable tables elsewhere in
 * the codebase there is no legacy-null cohort for `IS NULL` to reach: the
 * anonymous local-dev caller gets zero rows on all three reads, which is the
 * `catalogEmpty` EC-1 response rather than a global one.
 */
function ownerScope<T extends { userId: PgColumn }>(table: T, userId?: string) {
  return userId ? eq(table.userId, userId) : isNull(table.userId);
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function analyzeJobFit(
  input: AnalyzeJobFitInput,
  clientId: string = 'default',
  userId?: string
): Promise<{
  response: AnalyzeJobFitResponse;
  rateLimitHeaders: { remaining: number; reset: number };
}> {
  const hasText = input.jobDescriptionText !== undefined && input.jobDescriptionText !== '';
  const hasUrl = input.jobDescriptionUrl !== undefined && input.jobDescriptionUrl !== '';

  if (!hasText && !hasUrl) {
    throw new JobFitInputError(
      'JD_INPUT_REQUIRED',
      'Either jobDescriptionText or jobDescriptionUrl is required'
    );
  }
  if (hasText && hasUrl) {
    throw new JobFitInputError(
      'JD_INPUT_CONFLICT',
      'Provide either jobDescriptionText or jobDescriptionUrl, not both'
    );
  }

  // Before the rate-limit slot and before the LLM call, both of which are
  // billable and neither of which is refundable: an unresolvable `applicationId`
  // should cost the caller nothing.
  const applicationId = await resolveOwnedApplicationId(input.applicationId, userId);

  let jdText: string;
  let rateLimitHeaders: { remaining: number; reset: number };

  if (hasText) {
    const text = input.jobDescriptionText!;
    if (text.length < 50)
      throw new JobFitInputError(
        'JD_TEXT_TOO_SHORT',
        'jobDescriptionText must be at least 50 characters'
      );
    if (text.length > 50_000)
      throw new JobFitInputError(
        'JD_TEXT_TOO_LONG',
        'jobDescriptionText must not exceed 50,000 characters'
      );
    rateLimitHeaders = checkRateLimit(textBuckets, clientId, TEXT_LIMIT);
    jdText = text;
  } else {
    const url = input.jobDescriptionUrl!;
    if (url.length > 2048) {
      throw new JobFitInputError(
        'JD_URL_TOO_LONG',
        'jobDescriptionUrl must not exceed 2048 characters'
      );
    }
    try {
      new URL(url);
    } catch {
      throw new JobFitInputError('JD_URL_INVALID', 'jobDescriptionUrl is not a valid URL');
    }
    rateLimitHeaders = checkRateLimit(urlBuckets, clientId, URL_LIMIT);
    jdText = await fetchJobDescriptionFromUrl(url);
  }

  const parsed = await parseJobDescription(jdText);

  const db = getDb();
  let techTags, jfTags, bullets;
  try {
    [techTags, jfTags, bullets] = await Promise.all([
      db
        .select()
        .from(techStackTags)
        .where(ownerScope(techStackTags, userId))
        .orderBy(desc(techStackTags.mentionCount)),
      db
        .select()
        .from(jobFitTags)
        .where(ownerScope(jobFitTags, userId))
        .orderBy(desc(jobFitTags.mentionCount)),
      db.select().from(quantifiedBullets).where(ownerScope(quantifiedBullets, userId)),
    ]);
  } catch (error) {
    throw new AppError(
      'DATABASE_ERROR',
      'Failed to load catalog data',
      { cause: String(error) },
      500
    );
  }

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
      response: await persistAnalysis(input, userId, applicationId, {
        recommendation: null,
        fitScore: null,
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
      }),
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
      gaps.push({
        type: 'tech_stack',
        jdRequirement: term,
        isRequired: false,
        severity: gapSeverity(term, false),
      });
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
    hasSeniorityMismatch
  );
  const fitScore = computeFitScore(requiredTechMatches, totalRequired);

  const confidence: Confidence =
    parsed.requiredStack.length > 3 ? 'high' : parsed.requiredStack.length > 0 ? 'medium' : 'low';

  const recommendedStarEntries: RecommendedStarEntryDTO[] = bullets
    .map((b) => {
      const matchedTerms = parsed.requiredStack.filter((term) =>
        b.rawText.toLowerCase().includes(term.toLowerCase())
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
    response: await persistAnalysis(input, userId, applicationId, {
      recommendation,
      fitScore,
      summary: computeSummary(recommendation, strongMatches, partialMatches, gaps, totalRequired),
      confidence,
      parsedJd,
      strongMatches,
      partialMatches,
      gaps,
      recommendedStarEntries,
      catalogEmpty: false,
      analysisTimestamp: new Date().toISOString(),
    }),
    rateLimitHeaders,
  };
}

// ── Persistence (WIC-1652 / ADR-012) ─────────────────────────────────────────

/**
 * The analysis itself, before it has an identity.
 *
 * Splitting this out is what lets both `analyzeJobFit` exits — the
 * catalog-empty short circuit and the scored path — go through one write. An
 * earlier shape that persisted only the scored path would have made
 * `catalogEmpty: true` the one result a caller could never name, which is
 * exactly the result they are most likely to want to re-open.
 */
type AnalysisBody = Omit<AnalyzeJobFitResponse, 'id' | 'applicationId'>;

/**
 * Narrow a caller-supplied `applicationId` to one the caller owns.
 *
 * Returns `null` when nothing was supplied. Throws when something was supplied
 * that does not resolve — including the empty string, because
 * `z.string().optional()` admits `''` and a truthiness test would silently read
 * it as "not supplied" (the WIC-1818 trap, one layer up).
 *
 * The read is scoped by `user_id` and the error does not distinguish "no such
 * application" from "not yours", so this cannot be used to enumerate other
 * users' application ids.
 */
async function resolveOwnedApplicationId(
  applicationId: string | undefined,
  userId: string | undefined
): Promise<string | null> {
  if (applicationId === undefined) return null;

  const db = getDb();
  const whereClause = userId
    ? and(eq(applications.id, applicationId), eq(applications.userId, userId))
    : and(eq(applications.id, applicationId), isNull(applications.userId));

  const [row] = await db.select().from(applications).where(whereClause);
  if (!row) {
    throw new AppError('APPLICATION_NOT_FOUND', 'Application not found', { applicationId }, 404);
  }
  return row.id;
}

/**
 * Write the analysis down and return it with the id it was given.
 *
 * The write is not best-effort. Before WIC-1652 this endpoint returned a result
 * the caller could not name, so `jobFitAnalysisId` on the five generation
 * entry points was unpopulatable by any honest client; swallowing a failure
 * here would reproduce that state intermittently, which is worse than failing
 * the request. `analysisTimestamp` is the value already computed by the caller,
 * so the stored `analyzed_at` and the wire timestamp cannot disagree.
 */
async function persistAnalysis(
  input: AnalyzeJobFitInput,
  userId: string | undefined,
  applicationId: string | null,
  body: AnalysisBody
): Promise<AnalyzeJobFitResponse> {
  const db = getDb();
  const id = ulid();

  await db.insert(jobFitAnalyses).values({
    id,
    userId: userId ?? null,
    applicationId,
    jobDescriptionText: input.jobDescriptionText ?? null,
    jobDescriptionUrl: input.jobDescriptionUrl ?? null,
    recommendation: body.recommendation,
    fitScore: body.fitScore,
    summary: body.summary,
    confidence: body.confidence,
    parsedJd: body.parsedJd,
    strongMatches: body.strongMatches,
    partialMatches: body.partialMatches,
    gaps: body.gaps,
    recommendedStarEntries: body.recommendedStarEntries,
    catalogEmpty: body.catalogEmpty,
    analyzedAt: new Date(body.analysisTimestamp),
  });

  return { id, applicationId, ...body };
}

const DEFAULT_ANALYSIS_LIMIT = 20;
const MAX_ANALYSIS_LIMIT = 100;

/**
 * Stored analyses for this caller, newest first.
 *
 * `applicationId` is a filter rather than a required argument so the endpoint
 * can also answer "everything I have analysed". The owner term is applied
 * unconditionally and in conjunction with it — an application filter is not a
 * substitute for scoping, because application ids are caller-supplied.
 */
export async function listJobFitAnalyses(
  params: ListJobFitAnalysesParams,
  userId?: string
): Promise<ListJobFitAnalysesResponse> {
  const db = getDb();

  const ownerTerm = userId ? eq(jobFitAnalyses.userId, userId) : isNull(jobFitAnalyses.userId);
  const whereClause =
    params.applicationId === undefined
      ? ownerTerm
      : and(ownerTerm, eq(jobFitAnalyses.applicationId, params.applicationId));

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_ANALYSIS_LIMIT, 1), MAX_ANALYSIS_LIMIT);

  const rows = await db
    .select()
    .from(jobFitAnalyses)
    .where(whereClause)
    .orderBy(desc(jobFitAnalyses.analyzedAt))
    .limit(limit);

  return { analyses: rows.map(analysisToSummaryDTO) };
}

function analysisToSummaryDTO(row: JobFitAnalysis): JobFitAnalysisSummaryDTO {
  return {
    id: row.id,
    applicationId: row.applicationId,
    recommendation: row.recommendation ?? null,
    fitScore: row.fitScore,
    summary: row.summary,
    confidence: row.confidence,
    catalogEmpty: row.catalogEmpty,
    analyzedAt:
      row.analyzedAt instanceof Date ? row.analyzedAt.toISOString() : String(row.analyzedAt),
  };
}
