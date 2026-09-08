import { describe, expect, it } from 'vitest';

import { formatFileSize } from './formatFileSize';

/**
 * Boundary coverage for the shared byte formatter.
 *
 * The reachability half of this fix — that the upload progress line actually renders these
 * strings, and that the counter moves between progress events — is pinned in
 * `components/ResumeUpload.progress.test.tsx`. This file only pins the ladder itself, at
 * the two unit boundaries and either side of them.
 */

const KB = 1024;
const MB = 1024 * 1024;

describe('formatFileSize', () => {
  it('renders exact bytes below 1KB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('switches to KB at exactly 1024 bytes', () => {
    expect(formatFileSize(KB)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('switches to MB at exactly 1024KB, not before', () => {
    expect(formatFileSize(MB - 1)).toBe('1024.0 KB');
    expect(formatFileSize(MB)).toBe('1.0 MB');
  });

  /**
   * The regression that motivated extracting this. The pre-fix `ResumeUpload` copy had no
   * ladder, so every one of these collapsed to '0.0 MB' — including the 42KB case, which
   * is an ordinary .docx resume and the app's accepted format.
   */
  it.each([
    [2 * KB, '2.0 KB'],
    [18 * KB, '18.0 KB'],
    [42 * KB, '42.0 KB'],
    [80 * KB, '80.0 KB'],
  ])('renders a %i-byte resume as %s, not 0.0 MB', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  it('keeps MB for genuinely large files', () => {
    expect(formatFileSize(3 * MB)).toBe('3.0 MB');
    expect(formatFileSize(10 * MB)).toBe('10.0 MB');
  });
});
