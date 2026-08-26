/**
 * Branded units for normalized scores and rates.
 *
 * The convention is ADR-008 (`docs/architecture/adr/ADR-008-score-and-rate-unit-convention.md`):
 * **every normalized score, rate, fraction and proportion at the API boundary is a ratio in
 * `[0, 1]`; the presentation layer multiplies.** A field that deviates carries `Pct` in its
 * name, not in a comment.
 *
 * These types exist because the failure mode is two `number`s a compiler cannot distinguish.
 * `dashboard.service.ts` returned `responded / totalApplied` (a ratio) into a component that
 * rendered it raw with a `%`, so a 75% response rate displayed as `1%` (WIC-1514). Both sides
 * were `number`; both sides carried a `//` comment; the comments disagreed and nothing checked
 * them. Branding the unit into the type makes that assignment a compile error.
 *
 * `Ratio` is assignable to `number` (arithmetic still works). `number` is *not* assignable to
 * `Ratio`, and `Ratio` and `Percent` are not assignable to each other — so a conversion has to
 * be written down, at a site a reviewer can see.
 *
 * This file is mirrored at `packages/web/src/types/units.ts`. The two must stay identical; the
 * repo has no shared package, and duplicating ~90 lines is cheaper than introducing one for
 * this alone. If a shared package ever lands, this is a straight move.
 *
 * Adoption is incremental: a bare `number` is still legal, so new and touched fields get
 * branded without a big-bang refactor.
 */

/** A normalized value in `[0, 1]`. The unit of every score and rate at the API boundary. */
export type Ratio = number & { readonly __unit: 'ratio-0-1' };

/** A value in `[0, 100]`. A display unit, or a persisted deviation named with a `Pct` suffix. */
export type Percent = number & { readonly __unit: 'percent-0-100' };

/* ------------------------------------------------------------------------------------------
 * Compile-time proof that the brands actually discriminate.
 *
 * These are types, so they erase to nothing at runtime — but `npm run typecheck` evaluates
 * them, and any of them becoming `false` is a build error. That matters: the brands are the
 * entire enforcement mechanism of ADR-008, and nothing else in the repo checks them.
 * `packages/api/tsconfig.json` excludes `test/`, and Vitest transpiles without type-checking,
 * so a `@ts-expect-error` assertion written in a test file would be checked by nobody. This is
 * the assertion that has teeth; the one in `test/units.test.ts` is documentation of it.
 * ---------------------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type NotAssignable<A, B> = [A] extends [B] ? false : true;
type Assignable<A, B> = [A] extends [B] ? true : false;

/**
 * The invariants, as a single exported tuple. Exported rather than declared as loose aliases
 * because `noUnusedLocals` (on in `packages/web`) rejects an unreferenced type alias, and these
 * have no runtime referent to give them one.
 */
export type UnitBrandInvariants = [
  // A Ratio and a Percent are not interchangeable — the defect class ADR-008 exists to stop.
  Assert<NotAssignable<Ratio, Percent>>,
  Assert<NotAssignable<Percent, Ratio>>,
  // A bare number cannot be silently widened into either brand.
  Assert<NotAssignable<number, Ratio>>,
  Assert<NotAssignable<number, Percent>>,
  // But both remain usable as numbers, so arithmetic and `toFixed` keep working unchanged.
  Assert<Assignable<Ratio, number>>,
  Assert<Assignable<Percent, number>>,
];

export const isRatio = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 1;

export const isPercent = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 100;

/**
 * Assert that `n` is a ratio and brand it. Throws on anything outside `[0, 1]` — including
 * `NaN`, which is the shape a bad division produces and the one most worth failing loudly on.
 */
export function ratio(n: number): Ratio {
  if (!isRatio(n)) {
    throw new RangeError(`Expected a ratio in [0, 1], received ${n}`);
  }
  return n as Ratio;
}

/** Assert that `n` is a percent and brand it. Throws outside `[0, 100]`. */
export function percent(n: number): Percent {
  if (!isPercent(n)) {
    throw new RangeError(`Expected a percent in [0, 100], received ${n}`);
  }
  return n as Percent;
}

/**
 * Brand `n` as a ratio, clamping instead of throwing. For values from a source that is expected
 * to drift slightly out of range — floating-point accumulation, or an LLM asked for a score.
 * `NaN` clamps to `0`; a caller that would rather know should use `ratio()`.
 */
export const clampRatio = (n: number): Ratio =>
  (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0) as Ratio;

/** Brand `n` as a percent, clamping instead of throwing. `NaN` clamps to `0`. */
export const clampPercent = (n: number): Percent =>
  (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0) as Percent;

/** The one ratio → percent conversion. Rounds to a whole percent, matching how scores render. */
export const toPercent = (r: Ratio): Percent => Math.round(r * 100) as Percent;

/** The one percent → ratio conversion. */
export const toRatio = (p: Percent): Ratio => (p / 100) as Ratio;

/** Render a ratio for display: `0.75` → `"75%"`. The only place the multiplication belongs. */
export const formatRatioAsPercent = (r: Ratio, fractionDigits = 0): string =>
  `${(r * 100).toFixed(fractionDigits)}%`;

/**
 * Brand a value parsed from JSON, where the wire has no types to carry a brand.
 *
 * This is a deliberate, reviewable assertion — the point is that there is exactly *one* such
 * site per DTO field, rather than an unstated assumption at every use. It validates rather than
 * blindly casting, so a producer that regresses to the wrong unit fails here and not three
 * layers later in a render.
 */
export const ratioFromWire = (n: number, field: string): Ratio => {
  if (!isRatio(n)) {
    throw new RangeError(
      `${field}: expected a ratio in [0, 1] per ADR-008, received ${n}. ` +
        `If this field is genuinely 0-100 it must be named with a Pct suffix.`
    );
  }
  return n as Ratio;
};

/**
 * As `ratioFromWire`, for a field whose name carries the `Pct` deviation suffix.
 *
 * Note the asymmetry: this check is one-sided. `[0, 1]` is a subset of `[0, 100]`, so a producer
 * that regresses from `85` to `0.85` passes here and renders as `0.85%`. `ratioFromWire` has no
 * such blind spot — `85` is unambiguously not a ratio. That is one of the reasons ADR-008 §1
 * puts ratios at the boundary: only the ratio side can be validated at runtime, and the percent
 * side is defended by the `Percent` brand at compile time alone.
 */
export const percentFromWire = (n: number, field: string): Percent => {
  if (!isPercent(n)) {
    throw new RangeError(`${field}: expected a percent in [0, 100] per ADR-008, received ${n}`);
  }
  return n as Percent;
};
