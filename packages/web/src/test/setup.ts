import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

// Testing Library's own budget for `waitFor` and every `findBy*` query. It defaults to
// 1000ms and this repo configured it nowhere, so three files had grown per-site
// `{ timeout: 5_000 }` workarounds instead (WIC-1827 / PR #332). This is the repo default
// those were standing in for; they are removed (WIC-2086).
//
// ⚠️ This is NOT vitest's `testTimeout`, and raising that one does not cover this. The two
// timers are independent and nest: `asyncUtilTimeout` bounds a single query, `testTimeout`
// bounds the whole test. WIC-1889 (PR #322) raised `testTimeout`/`hookTimeout` to 15s in
// `vitest.config.ts`; a query can blow the 1000ms async-util budget while sitting far
// inside that 15s, and it surfaces as `TestingLibraryElementError: Unable to find
// role="..."` rather than as a timeout — so it does not even look like the WIC-1889 family.
//
// Measured, not picked. Every async-util call in the suite was timed by wrapping
// `getConfig().asyncWrapper` (delegating to RTL's existing act-aware wrapper), with the
// budget temporarily raised to 60s so the measurement was not censored by the limit it was
// measuring. 91 files / 831 tests, ~730 async-util calls per run, on 4 cores:
//
//   condition                                    p50     p99      max    calls > 1000ms
//   idle, cold cache, default pool             27.8ms   831ms   1289ms    4/733 (0.5%)
//   cold cache, --maxWorkers=8 (2x)            51.8ms  1444ms   2928ms   23/733 (3.1%)
//   cold cache, --maxWorkers=8 + load avg ~17  104.0ms  2941ms   5578ms   69/728 (9.5%)
//
// Individual waits exceed the stock 1000ms even on an **idle** box with the default worker
// count (4 calls, worst 1289ms) — but that is marginal rather than fatal: a full-suite run
// at the stock default, idle, was 831/831 green, because the same calls land under 1000ms
// on another run. Under load it stops being marginal. Paired negative control, identical
// load (`--maxWorkers=8` + 8 CPU burners, cold cache), full suite:
//
//   stock 1000ms  -> 4 `Unable to find role=...` failures
//   8000ms        -> 0
//
// (Both runs also carry the same 2 vitest `testTimeout` failures, which are the WIC-1889
// family and are unchanged by this setting — they appear identically at a 60s async-util
// budget. Those are an artifact of that deliberately extreme load, not of CI.)
//
// ⛔ Two of those 4 are `CatalogBrowseView.keyboardNav` and `WizardContainer.discardGuard`,
// which never had a per-site workaround. The hazard was never confined to the three files
// that had noticed it.
//
// ⛔ A targeted re-run of just the three outline files under the same load does NOT
// reproduce it — 6/6 green even at the stock default. The cost is full-suite contention,
// so a narrow repro is not a valid control for this setting. Use the whole suite.
//
// 8s is 1.43x the worst case measured under contention heavier than CI's, and ~6x the idle
// worst case (the same ratio WIC-1889 chose for `testTimeout`). It is deliberately well
// under that 15s ceiling: a query that genuinely never resolves must still fail as a
// Testing Library error carrying the DOM dump, and it only does that if the async-util
// budget expires before the test budget does. Do not raise this to 15s or above — that
// trades every "Unable to find role=..." message, with its rendered DOM, for a bare vitest
// timeout that says nothing about why.
//
// The cost when green is zero: these utils poll and return as soon as the condition holds,
// so a larger ceiling only changes how long a genuine failure takes to report.
configure({ asyncUtilTimeout: 8_000 });

// Node 22+ ships its own global `localStorage`/`sessionStorage` (the
// `--experimental-webstorage` flag, on by default on some versions), and without
// `--localstorage-file` set it wins over jsdom's window and exposes an object with
// `.setItem` etc. all `undefined` rather than throwing — every write silently no-ops.
// jsdom's own descriptor is configurable, so replace it with a real implementation
// here rather than depending on contributors' local Node flags. No-ops when the
// environment's own storage already works (e.g. in CI's pinned Node version).
function installWorkingStorage(name: 'localStorage' | 'sessionStorage') {
  if (typeof window[name]?.setItem === 'function') return;

  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
}

installWorkingStorage('localStorage');
installWorkingStorage('sessionStorage');

// Registers the jest-dom matchers (toBeInTheDocument, toBeDisabled, ...) on vitest's
// `expect` for every test file. Loaded via `setupFiles` in vitest.config.ts; the
// matching type augmentation lives in ./jest-dom.d.ts.
//
// Deliberately NOT the usual `import '@testing-library/jest-dom/vitest'`. That entry
// point does its own `import { expect } from 'vitest'`, and because jest-dom is hoisted
// to the workspace root it resolves to the root copy of vitest — which is @wic/api's
// vitest 1.x, not the vitest 4.x this package runs on. It then extends the wrong
// `expect` and every matcher fails with "Invalid Chai property: toBeInTheDocument".
// Importing the matchers as data and extending here binds them to the `expect` this
// file resolves, which is ours.
expect.extend(matchers);

// RTL only auto-cleans when a global `afterEach` exists, which it does not under
// `globals: false`. Without this, mounted trees leak between tests and queries like
// getByRole start matching the previous test's DOM.
afterEach(() => {
  cleanup();
});
