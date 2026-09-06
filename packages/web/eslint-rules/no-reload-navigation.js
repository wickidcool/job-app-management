/**
 * ESLint rule: no-reload-navigation
 *
 * Flags writes to `window.location` — `location.href = '/x'`, `location.assign('/x')`,
 * `location.replace('/x')` and the bare `window.location = '/x'` — inside an app that
 * routes with react-router.
 *
 * WHY. A `window.location` write is a document navigation: the browser tears down the
 * page, re-downloads the bundle and discards the React Query cache, then rebuilds the
 * exact view the SPA router would have rendered in place. The user sees a white flash and
 * pays a full round trip for a transition that costs nothing. `navigate('/x')` (or a
 * `<Link to="/x">`) is the same destination without any of that.
 *
 * Filed as WIC-1097, which closes the class WIC-1068 AC3.2 opened: AC3.2 removed the
 * `ProjectDetail` instance and pointed at "WIC-1044's sibling ticket on reload-class
 * navigation, filed alongside this one" — a ticket that was never filed, leaving the class
 * with exactly one survivor (`pages/ResumeManager.tsx`) and no owner. That site is fixed in
 * the same change as this rule, so the rule lands at ZERO findings and stays there.
 *
 * ⚠️ THE ZERO IS THE POINT, AND ALSO THE HAZARD. A rule with no findings on `main` is
 * indistinguishable from a rule that reports nothing at all — WIC-1903 measured exactly
 * that in this repo: no-op the single `context.report(...)` in `no-literal-caps-jsx-text`
 * and `caps-baseline.test.ts` was still green, and so was `npm run lint`. Everything this
 * rule claims is therefore pinned by src/test/reloadNavigation-rule.test.ts, which lints
 * synthetic snippets through the real resolved config and pairs every "must not flag" case
 * with a differential control that MUST flag. A tree-state assertion ("`src` has no
 * `location` writes") would pass just as well with this file deleted.
 *
 * RESOLUTION IS BY SCOPE, NOT BY NAME, and that is load-bearing rather than fastidious.
 * `location` in this tree is overwhelmingly react-router's `useLocation()` result — 20+
 * reads of `location.pathname` in components, hooks and tests. A name-matching rule would
 * report all of them. `isWindowLocation` therefore accepts a bare `location` identifier
 * only when it resolves to no declaration in any enclosing scope, i.e. the DOM global.
 *
 * READS ARE NOT WRITES. `const url = window.location.href` and
 * `if (window.location.pathname === '/x')` navigate nowhere and are not flagged. Only the
 * assignment and call forms are.
 *
 * KNOWN GAPS — each pinned with a control in the test file, so closing one is a deliberate
 * act rather than an accident:
 *   - `location.reload()`. A reload is not a navigation: it re-fetches the URL you are
 *     already on, and there is no router call that does it. Out of scope by design.
 *   - A `location` object reached through an alias (`const l = window.location; l.href = …`)
 *     or through a computed member (`window['location'].href = …`). One indirection
 *     defeats the rule, exactly as it defeats `no-usestate-from-prop`.
 *   - `<a href>` and `<form action>`, which are document navigations authored in markup.
 *     `route-integrity.test.ts` already reasons about those as link sites.
 *
 * OFF-SITE NAVIGATION IS A REAL NEED AND THE RULE DOES NOT SPECIAL-CASE IT. There is no
 * router call that leaves the origin, so `window.location.href = 'https://…'` is the
 * correct spelling and this rule will flag it. That is deliberate: the exemption belongs at
 * the site as an `eslint-disable-next-line` carrying the reason, which is the convention
 * this config already settled on for `jsx-a11y/no-autofocus` (see eslint.config.js — five
 * sites, each arguing its case). Encoding "absolute URLs are fine" in the rule instead
 * would silently permit `window.location.href = someVar` on the reasoning that it *might*
 * be off-site, which is the common case worth catching. Zero sites need the exemption
 * today.
 */

/** Properties whose assignment navigates the document. */
const NAVIGATING_PROPERTIES = new Set([
  'href',
  'pathname',
  'search',
  'hash',
  'protocol',
  'host',
  'hostname',
  'port',
]);

/** Methods on `location` that navigate the document. */
const NAVIGATING_METHODS = new Set(['assign', 'replace']);

/**
 * Is `node` the DOM's `window.location`?
 *
 * Accepts two spellings:
 *   - `window.location`, where `window` itself resolves to the global; and
 *   - a bare `location`, but ONLY when it resolves to no declaration — the DOM global.
 *
 * The second clause is what keeps react-router's `const location = useLocation()` out of
 * the rule. That binding resolves to a variable with a definition, so it is rejected here
 * and its `location.pathname` reads never reach a report.
 */
function isWindowLocation(node, scope) {
  if (!node) return false;

  // `window.location` (or `globalThis.location` / `self.location`).
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === 'location' &&
    node.object.type === 'Identifier' &&
    ['window', 'globalThis', 'self'].includes(node.object.name) &&
    isUnresolvedGlobal(node.object, scope)
  ) {
    return true;
  }

  // A bare `location` that is the global rather than a local binding.
  if (node.type === 'Identifier' && node.name === 'location') {
    return isUnresolvedGlobal(node, scope);
  }

  return false;
}

/**
 * Does `identifier` resolve to a global rather than to a declaration in scope?
 *
 * Walks the scope chain looking for the reference ESLint recorded for this exact node. A
 * reference whose `resolved` variable has no `defs` is a global (`window`, `location`); a
 * reference that resolves to a variable with a definition is a local, a parameter or an
 * import, and is not the DOM object.
 *
 * An identifier ESLint recorded no reference for at all (which should not happen for a
 * read) is treated as NOT global, so the rule stays silent rather than guessing.
 */
function isUnresolvedGlobal(identifier, scope) {
  for (let current = scope; current; current = current.upper) {
    const reference = current.references.find((ref) => ref.identifier === identifier);
    if (reference) {
      // `resolved === null` means ESLint found no declaration anywhere: a true global.
      // A resolved variable with zero `defs` is the same thing recorded differently —
      // `globals.browser` declares `window`/`location` in the global scope without a
      // syntactic definition.
      return reference.resolved === null || reference.resolved.defs.length === 0;
    }
  }
  return false;
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow document navigation via `window.location` writes; use the router instead.',
    },
    schema: [],
    messages: {
      reloadNavigation:
        'Writing to `{{expression}}` reloads the whole document — it discards the React Query cache and re-downloads the bundle to render a view the router can reach in place. Use `navigate({{suggestion}})` from `useNavigate()`, or a `<Link to={{suggestion}}>`. If the target is genuinely off-site, no router call can reach it: keep this line and add an `eslint-disable-next-line local/no-reload-navigation` above it saying so (WIC-1097).',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** The scope enclosing `node`, for reference resolution. */
    function scopeOf(node) {
      return sourceCode.getScope ? sourceCode.getScope(node) : context.getScope();
    }

    /**
     * Render the offending target back as source for the message, so the report names the
     * line the developer is looking at rather than a generic description.
     */
    function describe(node) {
      return sourceCode.getText(node);
    }

    /**
     * The destination, quoted, when it is a literal — otherwise a neutral placeholder.
     * Used to make the suggested `navigate(...)` call copy-pasteable.
     */
    function suggestionFor(valueNode) {
      if (valueNode && valueNode.type === 'Literal' && typeof valueNode.value === 'string') {
        return `'${valueNode.value}'`;
      }
      if (valueNode && valueNode.type === 'TemplateLiteral') {
        return sourceCode.getText(valueNode);
      }
      return '…';
    }

    return {
      AssignmentExpression(node) {
        const scope = scopeOf(node);
        const { left } = node;

        // `window.location = '/x'` — assigning the object itself.
        if (isWindowLocation(left, scope)) {
          context.report({
            node,
            messageId: 'reloadNavigation',
            data: { expression: describe(left), suggestion: suggestionFor(node.right) },
          });
          return;
        }

        // `window.location.href = '/x'`, `location.pathname = '/x'`, …
        if (
          left.type === 'MemberExpression' &&
          !left.computed &&
          left.property.type === 'Identifier' &&
          NAVIGATING_PROPERTIES.has(left.property.name) &&
          isWindowLocation(left.object, scope)
        ) {
          context.report({
            node,
            messageId: 'reloadNavigation',
            data: { expression: describe(left), suggestion: suggestionFor(node.right) },
          });
        }
      },

      CallExpression(node) {
        const { callee } = node;
        if (
          callee.type !== 'MemberExpression' ||
          callee.computed ||
          callee.property.type !== 'Identifier' ||
          !NAVIGATING_METHODS.has(callee.property.name)
        ) {
          return;
        }

        if (!isWindowLocation(callee.object, scopeOf(node))) return;

        context.report({
          node,
          messageId: 'reloadNavigation',
          data: { expression: describe(callee), suggestion: suggestionFor(node.arguments[0]) },
        });
      },
    };
  },
};
