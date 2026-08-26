/**
 * Branded numeric units.
 *
 * A plain `number` carries no unit, so a comment is the only thing telling you
 * whether `0.75` means "75%" or "0.75%". Comments do not typecheck. WIC-1514:
 * `responseRate` crossed the API/web boundary as a bare `number` documented
 * `// 0-1` on the API side and `// 0-100` on the component side, with no adapter
 * between them — so the Dashboard's "Response" card rendered `Math.round(0.75)`
 * and could only ever show "0%" or "1%".
 *
 * The unit of record is the API's. `responseRate` is a **ratio in [0, 1]**
 * (`docs/architecture/API_CONTRACTS.md`, `GET /dashboard`), matching the
 * convention UC-3 already uses for `relevanceScore`. **The presentation layer
 * converts**, via `toPercent` at the render site.
 *
 * ## What the brand does and does not catch
 *
 * Branding makes **declaration sites** checkable: a plain `number` can no longer
 * be assigned into a `Ratio` slot, and a `Ratio` can no longer be passed where a
 * `Percent` is expected. That is the direction WIC-1514 travelled — the wrong
 * unit reached the screen through an untyped passthrough — so it is the direction
 * worth guarding, and reverting the transport type in `services/api/types.ts` to
 * plain `number` does now fail `tsc`.
 *
 * It does **not** make the value opaque. `Ratio` is an intersection, so it is
 * still a `number` and arithmetic silently erases the brand. All of the following
 * compile today, verified against this file:
 *
 * ```ts
 * Math.round(r);      r * 100;      r >= 0.8;
 * r.toFixed(0);       `${r}%`;      const n: number = r;
 * ```
 *
 * So `toPercent` is the *sanctioned* ratio-to-percentage path, not the only
 * possible one, and the `* 100` it owns is the only one **for a `Ratio`** — the
 * package contains nine other `* 100` sites, two of which are this same
 * ratio-to-percent render on fields that are not branded yet
 * (`JobFitAnalysis.tsx`, `CatalogDiff/AmbiguityResolver.tsx`).
 *
 * The practical consequence: **a brand cannot protect a render site.** Nothing
 * here would stop someone writing `Math.round(stats.responseRate)` again. What
 * stops that is `DashboardStats.test.tsx`, which asserts six distinct ratios
 * render as six distinct readings. Keep that test.
 */

declare const unitBrand: unique symbol;

/**
 * A proportion in [0, 1]. `0.75` means 75%.
 *
 * This is the unit every rate crosses the API boundary in. Do not render it
 * directly — run it through {@link toPercent} first.
 */
export type Ratio = number & { readonly [unitBrand]: 'ratio-0-1' };

/** A percentage in [0, 100]. `75` means 75%. Suitable for display. */
export type Percent = number & { readonly [unitBrand]: 'percent-0-100' };

/**
 * Tag a plain number as a {@link Ratio}.
 *
 * Use this only where a value genuinely enters the type system for the first
 * time — a literal default, a test fixture, a parsed response. Every such call
 * is an unchecked assertion that the number really is in [0, 1], so keep them
 * few and keep them obvious.
 */
export function asRatio(value: number): Ratio {
  return value as Ratio;
}

/**
 * Convert a {@link Ratio} to a {@link Percent}.
 *
 * The only sanctioned ratio-to-percentage path in the web package. `0.75` -> `75`.
 */
export function toPercent(ratio: Ratio): Percent {
  return (ratio * 100) as Percent;
}
