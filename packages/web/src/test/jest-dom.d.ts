import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// Types for the jest-dom matchers registered in src/test/setup.ts.
//
// Written out here rather than pulled in from `@testing-library/jest-dom/vitest`, for
// the same reason setup.ts hand-registers them: that file's own `declare module 'vitest'`
// resolves `vitest` from the hoisted root copy (@wic/api's vitest 1.x), so it augments a
// different module than the one this package's tests import from. Declaring the
// augmentation from inside packages/web resolves to packages/web's vitest 4.x.
//
// `Matchers` is vitest's designated extension point and is declared `<T = any>`; the
// parameter list has to match its declaration exactly, so `any` is not optional here.
declare module 'vitest' {
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type */
  interface Matchers<T = any> extends TestingLibraryMatchers<any, T> {}
}
