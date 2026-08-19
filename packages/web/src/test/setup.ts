import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';

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
