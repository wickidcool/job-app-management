/**
 * Secret-material scanner (ADR-0001, Pillar 3 — WIC-879).
 *
 * Cheap insurance against another Anthropic-style leak (WIC-751), where an API
 * key rode into production as the *value* of a Worker binding — a non-secret
 * field that nobody thought of as a secret surface. Secrets must live only in
 * the secret store / injected env: never in resource names, binding names,
 * labels, or committed files.
 *
 * This module is the pure, dependency-injected core. It takes file contents in
 * and returns structured findings out — no filesystem, no git, no process exit —
 * so every path is unit-testable. `src/secret-scan.ts` is the thin CLI that
 * discovers committed files (via `git ls-files`) and feeds them here.
 *
 * Design rules:
 *   - Deterministic + low false-positive. Prefix/shape patterns require a
 *     realistic-length, high-signal suffix so placeholders like `sk-ant-...` or
 *     `your-anon-key` never trip. Generic high-entropy detection is opt-in per
 *     file (config/manifest files only) and skips ids/SHAs.
 *   - NEVER echoes secret material. Findings carry a *redacted* token (a short
 *     prefix + length) — never the full value.
 *   - Reports file + line + the offending *field* (binding/name/label/key), so
 *     the CI message points a human straight at what to fix.
 */

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export interface SecretPattern {
  /** Stable, greppable slug — also the allowlist key. */
  name: string;
  /** Global regex. Must have the `g` flag so all occurrences on a line match. */
  regex: RegExp;
  /** One-line human description of what it catches. */
  description: string;
}

/**
 * Prefix/shape patterns. Run on every scannable file. Each requires a
 * high-signal, realistic-length suffix so documentation placeholders and
 * example values (`sk-ant-...`, `AIza...`, `ghp_xxx`) do not match.
 */
export const PATTERNS: SecretPattern[] = [
  {
    name: 'github-pat-classic',
    regex: /\bghp_[A-Za-z0-9]{30,}\b/g,
    description: 'GitHub classic personal access token (ghp_…)',
  },
  {
    name: 'github-pat-fine-grained',
    regex: /\bgithub_pat_[A-Za-z0-9]{20,}_[A-Za-z0-9]{20,}\b/g,
    description: 'GitHub fine-grained personal access token (github_pat_…)',
  },
  {
    name: 'anthropic-api-key',
    regex: /\bsk-ant-[A-Za-z0-9]{2,}-[A-Za-z0-9_-]{24,}\b/g,
    description: 'Anthropic API key (sk-ant-…)',
  },
  {
    name: 'google-api-key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    description: 'Google / Gemini API key (AIza…)',
  },
  {
    name: 'aws-access-key-id',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    description: 'AWS access key id (AKIA…/ASIA…)',
  },
  {
    name: 'slack-token',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
    description: 'Slack token (xoxb/xoxp/…)',
  },
  {
    name: 'twilio-account-sid',
    regex: /\bAC[0-9a-f]{32}\b/g,
    description: 'Twilio Account SID (AC…)',
  },
  {
    name: 'twilio-api-key',
    regex: /\bSK[0-9a-f]{32}\b/g,
    description: 'Twilio API key SID (SK…)',
  },
  {
    name: 'cloudflare-api-token',
    regex: /\bcfut_[A-Za-z0-9_-]{20,}\b/g,
    description: 'Cloudflare API token (cfut_…)',
  },
  {
    name: 'private-key-block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    description: 'PEM/OpenSSH private key block',
  },
];

/** Name used for generic high-entropy hits (no known prefix). */
export const HIGH_ENTROPY_PATTERN = 'high-entropy-token';

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export interface Finding {
  /** Repo-relative path of the file. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the match start. */
  column: number;
  /** Pattern slug (or HIGH_ENTROPY_PATTERN). */
  pattern: string;
  /** The config field the value sits in (binding/name/label/key), if derivable. */
  field?: string;
  /** Redacted token — short prefix + length. NEVER the full secret. */
  redacted: string;
}

/** Redact a token to a short, safe fingerprint: first few chars + length. */
export function redact(token: string): string {
  const head = token.slice(0, Math.min(4, token.length));
  return `${head}…(${token.length} chars)`;
}

/**
 * Derive the "field" a value belongs to from a config/manifest line, e.g.
 *   "binding": "sk-ant-…"      -> binding
 *   name = "AKIA…"             -> name
 *   ANTHROPIC_API_KEY=sk-ant-… -> ANTHROPIC_API_KEY
 * Returns undefined for prose / free-text lines.
 */
export function extractField(line: string): string | undefined {
  const m = line.match(/^\s*(?:-\s*)?["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*[:=]/);
  return m ? m[1] : undefined;
}

// ---------------------------------------------------------------------------
// Entropy
// ---------------------------------------------------------------------------

/** Shannon entropy in bits per character. */
export function shannonEntropy(str: string): number {
  if (!str) return 0;
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

const ENTROPY_MIN_LEN = 32;
const ENTROPY_MIN_BITS = 4.0;

/**
 * A kebab/snake segment shaped like a word: a lowercase alphabetic run, long
 * enough to be pronounceable but short enough that it cannot itself be secret
 * material. The upper bound is load-bearing — without it a 24-char opaque tail
 * such as `abcdefghijklmnopqrstuvwx` counts as a "word" (WIC-1270).
 */
const WORD_SEGMENT = /^[a-z]{3,16}$/;
/** How many word-shaped segments make a token a human-authored identifier. */
const IDENTIFIER_MIN_WORDS = 2;
/**
 * Longest non-word segment an identifier may carry. A real slug's non-word
 * segments are short refs (`wic1184`, `v2`, `2025`); anything longer is opaque
 * material riding on a human-readable prefix, which is exactly the WIC-751
 * shape this module exists to catch.
 */
const MAX_OPAQUE_SEGMENT = 8;
/** Word segments must *dominate* an identifier, not merely appear in it. */
const MIN_WORD_CHAR_RATIO = 0.5;

/**
 * True for lowercase `-`/`_`-delimited identifiers built out of real words:
 * branch names (`wic1184-deshout-quickref-wireframes`), resource slugs
 * (`jobtrail-documents-preview-bucket`), job ids. These carry high Shannon
 * entropy purely because English words use many distinct letters, so the
 * entropy floor alone cannot tell them apart from an opaque token.
 *
 * Deliberately narrow. A token qualifies only when *all four* hold:
 *   1. it is all lowercase (uppercase is the dominant shape of real secrets),
 *   2. separators split it into 3+ segments,
 *   3. 2+ segments are bounded lowercase alphabetic runs (`WORD_SEGMENT`) and
 *      no *other* segment is long enough to hide a secret, and
 *   4. those word segments account for at least half the token's characters.
 *
 * Rules 3 and 4 are what keep the carve-out from becoming a bypass. The
 * tokenizer grabs the maximal `[A-Za-z0-9_-]` run, so without them a wordy
 * prefix would exempt whatever is appended to it — `jobtrail-prod-anthropic-
 * key-x7q2m9v4z1` would pass on the strength of `jobtrail`/`prod`/`anthropic`
 * alone, and random dash-grouped tokens would slip through whenever two groups
 * happened to come out all-alpha (WIC-1270).
 *
 * A UUID has five segments and zero word segments, so it was never excluded.
 */
export function looksLikeWordyIdentifier(token: string): boolean {
  if (/[A-Z]/.test(token)) return false;
  if (!/[-_]/.test(token)) return false;
  const segments = token.split(/[-_]+/).filter(Boolean);
  if (segments.length < 3) return false;
  const words = segments.filter((s) => WORD_SEGMENT.test(s));
  if (words.length < IDENTIFIER_MIN_WORDS) return false;
  // No opaque chunk big enough to be a secret, however wordy its neighbours.
  if (segments.some((s) => !WORD_SEGMENT.test(s) && s.length > MAX_OPAQUE_SEGMENT)) return false;
  const wordChars = words.reduce((n, s) => n + s.length, 0);
  return wordChars / token.length >= MIN_WORD_CHAR_RATIO;
}

/**
 * Heuristic for a generic secret with no recognizable prefix (opaque API tokens,
 * JWTs, base64 blobs). Conservative on purpose — it deliberately ignores:
 *   - short strings (< 32 chars),
 *   - pure hexadecimal (git SHAs, resource ids like a Hyperdrive/R2 id),
 *   - tokens without both letters and digits (prose runs, numeric ids),
 *   - lowercase word-delimited identifiers (branch names, resource slugs).
 * so structured config with ids and connection strings stays clean.
 */
export function looksHighEntropy(token: string): boolean {
  if (token.length < ENTROPY_MIN_LEN) return false;
  // base64url charset only — excludes URLs (`/`, `.`) and `KEY=VALUE` docs (`=`),
  // which are the dominant false-positive shapes in configs/workflows.
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return false;
  // Pure hex → id / SHA / checksum, not a secret shape we flag generically.
  if (/^[0-9a-fA-F]+$/.test(token)) return false;
  // Require both letters and digits — real high-entropy tokens mix them.
  if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) return false;
  // Human-authored slug/branch name → identifier, not secret material.
  if (looksLikeWordyIdentifier(token)) return false;
  return shannonEntropy(token) >= ENTROPY_MIN_BITS;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

export interface AllowEntry {
  /** Repo-relative path or glob (`*` = within a segment, `**` = any depth). */
  file: string;
  /** Optional exact line number. */
  line?: number;
  /** Optional pattern slug to scope the suppression. */
  pattern?: string;
  /** Why this is allowed — required for auditability (not enforced here). */
  reason?: string;
}

export interface Allowlist {
  allow: AllowEntry[];
}

/** Inline pragma markers that suppress findings on the same source line. */
const INLINE_ALLOW = /secret-scan[\s:-]?allow|pragma:\s*allowlist\s+secret/i;

function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // consume trailing slash of `**/`
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function isAllowlisted(finding: Finding, allowlist: Allowlist | undefined): boolean {
  if (!allowlist?.allow?.length) return false;
  return allowlist.allow.some((entry) => {
    if (entry.line !== undefined && entry.line !== finding.line) return false;
    if (entry.pattern !== undefined && entry.pattern !== finding.pattern) return false;
    return globToRegExp(entry.file).test(finding.file);
  });
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

export interface ScanFileInput {
  /** Repo-relative path (used for reporting + allowlist matching). */
  path: string;
  content: string;
  /** Enable generic high-entropy detection (config/manifest files only). */
  enableEntropy?: boolean;
}

export interface ScanOptions {
  allowlist?: Allowlist;
}

/** Scan a single file's text. Pure — no I/O. */
export function scanText(
  file: string,
  content: string,
  opts: { enableEntropy?: boolean; allowlist?: Allowlist } = {}
): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (INLINE_ALLOW.test(line)) continue; // locally acknowledged
    const lineNo = i + 1;
    const field = extractField(line);
    // Track spans matched by named patterns so generic entropy doesn't double-report.
    const matchedSpans: Array<[number, number]> = [];

    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.regex.exec(line)) !== null) {
        matchedSpans.push([m.index, m.index + m[0].length]);
        findings.push({
          file,
          line: lineNo,
          column: m.index + 1,
          pattern: pattern.name,
          field,
          redacted: redact(m[0]),
        });
        if (m[0].length === 0) pattern.regex.lastIndex++; // guard against zero-width
      }
    }

    if (opts.enableEntropy) {
      const tokenRe = /[A-Za-z0-9_-]{32,}/g;
      let t: RegExpExecArray | null;
      while ((t = tokenRe.exec(line)) !== null) {
        const start = t.index;
        const end = start + t[0].length;
        const overlaps = matchedSpans.some(([s, e]) => start < e && end > s);
        if (overlaps) continue;
        if (!looksHighEntropy(t[0])) continue;
        findings.push({
          file,
          line: lineNo,
          column: start + 1,
          pattern: HIGH_ENTROPY_PATTERN,
          field,
          redacted: redact(t[0]),
        });
      }
    }
  }

  return opts.allowlist ? findings.filter((f) => !isAllowlisted(f, opts.allowlist)) : findings;
}

/** Scan many files. Returns all surviving (non-allowlisted) findings. */
export function scanFiles(files: ScanFileInput[], opts: ScanOptions = {}): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    findings.push(
      ...scanText(f.path, f.content, {
        enableEntropy: f.enableEntropy,
        allowlist: opts.allowlist,
      })
    );
  }
  return findings;
}

/** Format one finding as a single stable CI line. Never contains raw secrets. */
export function formatFinding(f: Finding): string {
  const where = `${f.file}:${f.line}:${f.column}`;
  const fieldPart = f.field ? ` field="${f.field}"` : '';
  return `${where}  [${f.pattern}]${fieldPart}  ${f.redacted}`;
}
