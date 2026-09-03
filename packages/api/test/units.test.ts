import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clampPercent,
  clampRatio,
  formatRatioAsPercent,
  isPercent,
  isRatio,
  percent,
  percentFromWire,
  ratio,
  ratioFromWire,
  toPercent,
  toRatio,
  type Percent,
  type Ratio,
} from '../src/types/units.js';

describe('ADR-008 unit brands', () => {
  describe('ratio()', () => {
    it('accepts the closed interval [0, 1]', () => {
      expect(ratio(0)).toBe(0);
      expect(ratio(1)).toBe(1);
      expect(ratio(0.85)).toBe(0.85);
    });

    it('rejects a percent handed in where a ratio was expected', () => {
      // The WIC-1514 shape: a 0-100 value reaching a 0-1 boundary.
      expect(() => ratio(75)).toThrow(RangeError);
    });

    it('rejects NaN — the shape a bad division produces', () => {
      expect(() => ratio(0 / 0)).toThrow(RangeError);
      expect(() => ratio(Infinity)).toThrow(RangeError);
      expect(() => ratio(-0.01)).toThrow(RangeError);
    });
  });

  describe('percent()', () => {
    it('accepts the closed interval [0, 100]', () => {
      expect(percent(0)).toBe(0);
      expect(percent(100)).toBe(100);
      expect(percent(92)).toBe(92);
    });

    it('rejects out-of-range and non-finite input', () => {
      expect(() => percent(101)).toThrow(RangeError);
      expect(() => percent(-1)).toThrow(RangeError);
      expect(() => percent(Number.NaN)).toThrow(RangeError);
    });
  });

  describe('clamping constructors', () => {
    it('clamps rather than throwing, for drifting sources', () => {
      // interviewPrep.service.ts clamps an LLM-produced score exactly this way.
      expect(clampPercent(140)).toBe(100);
      expect(clampPercent(-3)).toBe(0);
      expect(clampRatio(1.0000000000000002)).toBe(1);
      expect(clampRatio(-0)).toBe(0);
    });

    it('clamps non-finite input to 0 rather than propagating NaN', () => {
      expect(clampRatio(Number.NaN)).toBe(0);
      expect(clampPercent(Number.NaN)).toBe(0);
      expect(clampRatio(Infinity)).toBe(0);
    });
  });

  describe('conversion', () => {
    it('rounds ratio → percent to a whole percent', () => {
      expect(toPercent(ratio(0.75))).toBe(75);
      expect(toPercent(ratio(0.855))).toBe(86);
      expect(toPercent(ratio(0))).toBe(0);
      expect(toPercent(ratio(1))).toBe(100);
    });

    it('round-trips a whole percent losslessly', () => {
      for (const p of [0, 1, 37, 92, 100]) {
        expect(toPercent(toRatio(percent(p)))).toBe(p);
      }
    });

    it('produces a value in range for every ratio it is given', () => {
      for (const r of [0, 0.004, 0.5, 0.999, 1]) {
        expect(isPercent(toPercent(ratio(r)))).toBe(true);
      }
    });
  });

  describe('formatRatioAsPercent()', () => {
    it('renders the WIC-1514 case correctly', () => {
      // The shipped bug rendered this as "1%": a ratio printed raw with a % sign.
      expect(formatRatioAsPercent(ratio(0.75))).toBe('75%');
    });

    it('honours a fraction-digit request', () => {
      expect(formatRatioAsPercent(ratio(0.8567), 1)).toBe('85.7%');
      expect(formatRatioAsPercent(ratio(0), 2)).toBe('0.00%');
    });
  });

  describe('wire constructors', () => {
    it('names the field when a producer sends the wrong unit', () => {
      expect(() => ratioFromWire(85, 'relevanceScore')).toThrow(/relevanceScore/);
      expect(() => ratioFromWire(85, 'relevanceScore')).toThrow(/Pct suffix/);
      expect(() => percentFromWire(101, 'relevanceScorePct')).toThrow(/relevanceScorePct/);
    });

    it('cannot detect a ratio sent to a percent field — the check is one-sided', () => {
      // [0, 1] is a subset of [0, 100], so a producer that regresses from `85` to `0.85` on a
      // Pct field passes validation and renders as "0.85%". There is no runtime check that
      // recovers this; only the `Percent` brand does, at compile time.
      //
      // The reverse is detectable — `ratioFromWire(85)` throws above — and that asymmetry is
      // one of the reasons ADR-008 §1 puts ratios at the boundary rather than percents.
      expect(percentFromWire(0.85, 'relevanceScorePct')).toBe(0.85);
    });

    it('passes through a value in the declared unit', () => {
      expect(ratioFromWire(0.85, 'relevanceScore')).toBe(0.85);
      expect(percentFromWire(92, 'relevanceScorePct')).toBe(92);
    });
  });

  describe('predicates', () => {
    it('isRatio / isPercent agree with their constructors', () => {
      expect(isRatio(0.5)).toBe(true);
      expect(isRatio(50)).toBe(false);
      expect(isPercent(50)).toBe(true);
      expect(isPercent(0.5)).toBe(true); // 0.5 is a legal, if unusual, percent
      expect(isPercent(101)).toBe(false);
    });
  });

  describe('the brands are structurally distinct', () => {
    // The load-bearing check lives in `src/types/units.ts` as the exported
    // `UnitBrandInvariants` tuple, NOT here. `packages/api/tsconfig.json` excludes `test/`, and
    // Vitest transpiles without type-checking, so a `@ts-expect-error` written in this file
    // would be verified by nothing at all. `UnitBrandInvariants` is inside `src/**`, so
    // `npm run typecheck` evaluates it in both packages and a collapsed brand is a build
    // failure. Verified by mutation: identical `__unit` literals produce TS2344 in each.
    it('keeps a brand usable as a number, so arithmetic still works', () => {
      const r: Ratio = ratio(0.5);
      const p: Percent = percent(50);
      expect(r * 2).toBe(1);
      expect(p + 1).toBe(51);
      expect(r.toFixed(2)).toBe('0.50');
    });
  });

  describe('the api and web copies do not drift', () => {
    it('is byte-identical to packages/web/src/types/units.ts, modulo the mirror pointer', () => {
      // The repo has no shared package, so this module is duplicated. That is only safe if the
      // duplication is checked; otherwise one side gains a fix the other does not, which is the
      // same class of defect ADR-008 was written to close.
      const here = fileURLToPath(import.meta.url);
      const strip = (p: string) =>
        readFileSync(p, 'utf8')
          .split('\n')
          .filter((l) => !l.includes('mirrored at'))
          .join('\n');

      const api = strip(resolve(dirname(here), '../src/types/units.ts'));
      const web = strip(resolve(dirname(here), '../../web/src/types/units.ts'));

      expect(web).toBe(api);
    });
  });
});
