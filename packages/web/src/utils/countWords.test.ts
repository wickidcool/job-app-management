import { describe, expect, it } from 'vitest';

import { countWords } from './countWords';

/**
 * The arithmetic half of WIC-2301, kept separate from the render half on purpose.
 *
 * The defect that prompted this module lived entirely in `CoverLetterPreview`'s *gate*, not
 * in the count — so these cases pass identically before and after that fix. That is what
 * makes them the control: they prove the fix is scoped to the gating and changes no
 * arithmetic. The render-side cover, which does go red before the fix, lives in
 * `CoverLetterPreview.test.tsx`.
 */
describe('countWords', () => {
  it('counts words separated by single spaces', () => {
    expect(countWords('Dear Hiring Manager')).toBe(3);
  });

  /**
   * The rung the `trim() === ''` branch exists for. `''.split(/\s+/)` is `['']` — length
   * **1** — so the obvious one-liner reports "1 words" for an empty letter. This is the
   * assertion that dies if someone simplifies the branch away.
   */
  it('reports zero, not one, for an empty string', () => {
    expect(countWords('')).toBe(0);
  });

  /**
   * Reachable, not theoretical: the API's update schema is `content: z.string().min(1)`,
   * which admits `' '`. `min(1)` rejects the empty string and nothing else.
   */
  it('reports zero for whitespace-only content', () => {
    expect(countWords('   \n\t  ')).toBe(0);
  });

  it('does not count leading or trailing whitespace as words', () => {
    expect(countWords('  Sincerely, A. Candidate  ')).toBe(3);
  });

  it('treats a run of mixed whitespace as one separator', () => {
    expect(countWords('Dear   Hiring\n\nManager\tagain')).toBe(4);
  });

  it('counts a single word', () => {
    expect(countWords('Sincerely')).toBe(1);
  });
});
