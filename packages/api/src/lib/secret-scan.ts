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
 * Heuristic for a generic secret with no recognizable prefix (opaque API tokens,
 * JWTs, base64 blobs). Conservative on purpose — it deliberately ignores:
 *   - short strings (< 32 chars),
 *   - pure hexadecimal (git SHAs, resource ids like a Hyperdrive/R2 id),
 *   - all-lowercase alphanumeric ids (slugs, project refs).
 * so structured config with ids and connection strings stays clean.
 */
export function looksHighEntropy(token: string): boolean {
  if (token.length < ENTROPY_MIN_LEN) return false;
  // base64url charset only — excludes URLs (`/`, `.`) and `KEY=VALUE` docs (`=`),
  // which are the dominant false-positive shapes in configs/workflows.
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return false;
  // Pure hex → id / SHA / checksum, not a secret shape we flag generically.
  if (/^[0-9a-fA-F]+$/.test(token)) return false;
  // All-lowercase alphanumeric with no digits-and-mixed-case signal → slug/id.
  if (/^[a-z0-9]+$/.test(token) && !/^[a-z]*[0-9][a-z0-9]*$/.test(token)) return false;
  // Kebab-case slug (branch names, image tags, long identifiers): 3+ lowercase-alphanumeric
  // segments joined by hyphens. Real secrets virtually never decompose this cleanly — they
  // either contain uppercase, or are a single undelimited random string. WIC-1265 regression.
  if (/^[a-z0-9]+(-[a-z0-9]+){2,}$/.test(token)) return false;
  // Require both letters and digits — real high-entropy tokens mix them.
  if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) return false;
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

    if (opts.enableEntropy && !/^\s*(#|\/\/)/.test(line)) {
      // Skip comment lines for generic entropy — named patterns above still run on them,
      // so a real credential pasted into a comment is still caught. The entropy heuristic
      // only suppresses structured prose like branch names and slugs. WIC-1265.
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
