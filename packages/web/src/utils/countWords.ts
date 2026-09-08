/**
 * The word count the cover-letter surfaces render, in one place.
 *
 * ## Why this is a module and not three inline ternaries
 *
 * It was three inline ternaries — `CoverLetterPreview:64`, `CoverLetterDetail:131` and the
 * editor pane at `CoverLetterGenerator:625` — each spelling the same expression by hand.
 * They happened to agree, which is the state every duplicated helper in this repo has been
 * in right up until it stopped: `constants/upload.ts` exists because a duplicated upload
 * *limit* drifted (WIC-1382). Same class, one layer over. Giving the expression one home is
 * the convention that card paid for.
 *
 * A second instance of the same convention is in flight but **not yet on `main`** —
 * `utils/formatFileSize.ts`, for a duplicated *byte formatter* (WIC-2299, PR #478). Do not
 * cite it as settled precedent until that lands; today the count is one.
 *
 * It also makes the count checkable on its own. The gating defect this module was extracted
 * for lives in the *render*, not the arithmetic, and separating the two is what let the
 * arithmetic keep a passing test across the fix — the control proving the change is scoped
 * to the gate.
 *
 * ## `0` is a real count, and the callers must be able to say so
 *
 * The whole reason this returns a plain `number` and never `undefined` is that a blank
 * letter has a *known* count of zero, not an absent one. Callers must therefore test
 * `!= null` / `!== undefined` on an optional count and never truthiness: `wordCount || …`
 * and `{wordCount && …}` both treat a genuine `0` as "no count", which is exactly how the
 * preview footer came to render a bare, unlabelled `0` glyph where "📊 0 words" belonged.
 *
 * ## Whitespace-only content counts as zero, deliberately
 *
 * `''.split(/\s+/)` returns `['']` — length 1 — so a naive split reports **one** word for an
 * empty string, and `'   '.trim().split(/\s+/)` does the same. The `trim() === ''` branch is
 * not defensive padding; it is the only thing standing between a blank letter and a
 * confident "1 words". Whitespace-only content is reachable: the API's update schema is
 * `content: z.string().min(1)`, which admits `' '`.
 */
export function countWords(content: string): number {
  const trimmed = content.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
