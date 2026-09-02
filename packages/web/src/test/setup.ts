import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

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
