import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  scanText,
  scanFiles,
  extractField,
  redact,
  shannonEntropy,
  looksHighEntropy,
  isAllowlisted,
  formatFinding,
  HIGH_ENTROPY_PATTERN,
  type Finding,
} from '../src/lib/secret-scan.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'secret-scan');
const readFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

// Build tokens at runtime so this test file carries no committed literal secrets.
const chunk = (c: string, n: number) => c.repeat(n);
const SK_ANT = `sk-ant-api03-${chunk('A', 20)}${chunk('9', 20)}`;
const GHP = `ghp_${chunk('a', 20)}${chunk('B', 20)}`;
const AIZA = `AIza${chunk('b', 35)}`;

describe('secret-scan patterns', () => {
  it('catches an sk-ant- key smuggled into a binding name (WIC-751 leak shape)', () => {
    // The exact ADR-0001 Pillar 3 requirement: a secret in a non-secret field.
    const findings = scanText('wrangler.jsonc', readFixture('leaky-wrangler.jsonc'), {
      enableEntropy: true,
    });
    const antKey = findings.find((f) => f.pattern === 'anthropic-api-key');
    expect(antKey).toBeDefined();
    expect(antKey!.field).toBe('binding');
    expect(antKey!.file).toBe('wrangler.jsonc');
    // Never echoes the raw secret.
    expect(antKey!.redacted).not.toContain('AAAABBBB');
  });

  it('passes a clean config (ids, connection strings, no secrets)', () => {
    const findings = scanText('wrangler.jsonc', readFixture('clean-wrangler.jsonc'), {
      enableEntropy: true,
    });
    expect(findings).toEqual([]);
  });

  it('detects each supported prefix/shape pattern', () => {
    const cases: Array<[string, string]> = [
      ['github-pat-classic', `token = "${GHP}"`],
      ['github-pat-fine-grained', `token = "github_pat_${chunk('a', 22)}_${chunk('b', 40)}"`],
      ['anthropic-api-key', `key: "${SK_ANT}"`],
      ['google-api-key', `key: "${AIZA}"`],
      ['aws-access-key-id', `id = "AKIA${chunk('Z', 16)}"`],
      ['slack-token', `t = "xoxb-${chunk('1', 12)}-${chunk('a', 12)}"`],
      ['twilio-account-sid', `sid = "AC${chunk('a', 32)}"`],
      ['cloudflare-api-token', `cf = "cfut_${chunk('x', 30)}"`],
      // WIC-902 leak shape: a Supabase secret key reached the built bundle.
      ['supabase-secret-key', `k = "sb_secret_${chunk('a', 20)}${chunk('B', 10)}9"`],
      ['supabase-publishable-key', `k = "sb_publishable_${chunk('a', 20)}${chunk('B', 10)}9"`],
      ['private-key-block', `-----BEGIN RSA ${'PRIVATE'} KEY-----`],
    ];
    for (const [name, line] of cases) {
      const findings = scanText('f', line);
      expect(
        findings.map((f) => f.pattern),
        `pattern ${name}`
      ).toContain(name);
    }
  });

  it('does NOT flag documentation placeholders / example values', () => {
    const benign = [
      'ANTHROPIC_API_KEY=sk-ant-...',
      'SUPABASE_ANON_KEY=your-anon-key',
      'token: ghp_xxx',
      'key = "AIza..."',
      '# set ANTHROPIC_API_KEY via wrangler secret put',
      'bucket_name = "jobtrail-documents"',
    ].join('\n');
    expect(scanText('.dev.vars.example', benign, { enableEntropy: true })).toEqual([]);
  });
});

describe('field extraction', () => {
  it('pulls the key from json/yaml/toml/env lines', () => {
    expect(extractField('  "binding": "x"')).toBe('binding');
    expect(extractField('name = "y"')).toBe('name');
    expect(extractField('  - SUPABASE_URL: z')).toBe('SUPABASE_URL');
    expect(extractField('ANTHROPIC_API_KEY=v')).toBe('ANTHROPIC_API_KEY');
    expect(extractField('just some prose here')).toBeUndefined();
  });
});

describe('entropy heuristics', () => {
  it('computes shannon entropy', () => {
    expect(shannonEntropy('')).toBe(0);
    expect(shannonEntropy('aaaa')).toBe(0);
    expect(shannonEntropy('abcd')).toBeCloseTo(2, 5);
  });

  it('ignores ids/SHAs/slugs but flags real high-entropy tokens', () => {
    expect(looksHighEntropy('374db58fe1014823a9e54ba393125676')).toBe(false); // 32-hex id
    expect(looksHighEntropy('a'.repeat(40))).toBe(false); // low entropy
    expect(looksHighEntropy('jobtrail-documents-dev')).toBe(false); // slug, too short
    // A genuinely random mixed-case+digit base64-ish blob.
    expect(looksHighEntropy('Xk9Qm2Zr7Lp0Ab5Cd8Ef3Gh6Ij1Kl4Mn')).toBe(true);
  });

  it('only runs generic entropy scanning when enabled', () => {
    const line = 'opaque = "Xk9Qm2Zr7Lp0Ab5Cd8Ef3Gh6Ij1Kl4Mn"';
    expect(scanText('src/foo.ts', line, { enableEntropy: false })).toEqual([]);
    const on = scanText('wrangler.toml', line, { enableEntropy: true });
    expect(on.map((f) => f.pattern)).toContain(HIGH_ENTROPY_PATTERN);
  });
});

describe('allowlist', () => {
  const finding: Finding = {
    file: 'packages/api/test/fixtures/secret-scan/leaky-wrangler.jsonc',
    line: 14,
    column: 5,
    pattern: 'anthropic-api-key',
    field: 'binding',
    redacted: redact('sk-ant-xxxx'),
  };

  it('suppresses by file glob', () => {
    expect(isAllowlisted(finding, { allow: [{ file: '**/fixtures/**' }] })).toBe(true);
    expect(isAllowlisted(finding, { allow: [{ file: 'src/**' }] })).toBe(false);
  });

  it('scopes by line and pattern when provided', () => {
    expect(
      isAllowlisted(finding, {
        allow: [{ file: '**/fixtures/**', line: 14, pattern: 'anthropic-api-key' }],
      })
    ).toBe(true);
    expect(isAllowlisted(finding, { allow: [{ file: '**/fixtures/**', line: 99 }] })).toBe(false);
    expect(
      isAllowlisted(finding, { allow: [{ file: '**/fixtures/**', pattern: 'github-pat-classic' }] })
    ).toBe(false);
  });

  it('honors an inline pragma on the source line', () => {
    const line = `key = "${SK_ANT}" // secret-scan:allow test fixture`;
    expect(scanText('f', line)).toEqual([]);
    const line2 = `key = "${SK_ANT}" # pragma: allowlist secret`;
    expect(scanText('f', line2)).toEqual([]);
  });

  it('scanFiles applies the allowlist across files', () => {
    const files = [
      { path: 'a/leaky.jsonc', content: `binding = "${SK_ANT}"` },
      { path: 'b/leaky.jsonc', content: `binding = "${SK_ANT}"` },
    ];
    const all = scanFiles(files);
    expect(all).toHaveLength(2);
    const filtered = scanFiles(files, { allowlist: { allow: [{ file: 'a/**' }] } });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].file).toBe('b/leaky.jsonc');
  });
});

describe('formatting', () => {
  it('redact never contains the full token', () => {
    const r = redact('sk-ant-supersecretvalue123456789');
    expect(r).not.toContain('supersecret');
    expect(r).toMatch(/\(\d+ chars\)/);
  });

  it('formats a stable single line', () => {
    const f: Finding = {
      file: 'wrangler.jsonc',
      line: 14,
      column: 5,
      pattern: 'anthropic-api-key',
      field: 'binding',
      redacted: 'sk-a…(41 chars)',
    };
    expect(formatFinding(f)).toBe(
      'wrangler.jsonc:14:5  [anthropic-api-key] field="binding"  sk-a…(41 chars)'
    );
  });
});
