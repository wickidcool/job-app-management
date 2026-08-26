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
 * Branding makes the boundary itself checkable: a plain `number` can no longer
 * be dropped into a `Ratio` slot, and a `Ratio` can no longer be handed to
 * something expecting a `Percent`. Crossing between the two is only possible
 * through `toPercent`, which is where the `* 100` lives exactly once.
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
