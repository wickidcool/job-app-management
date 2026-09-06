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
 * RESOLUTION IS BY SCOPE, NOT BY NAME. `isWindowLocation` accepts a bare `location`
 * identifier only when it resolves to no declaration in any enclosing scope, i.e. the DOM
 * global.
 *
 * ⚠️ BE PRECISE ABOUT WHAT THAT BUYS, because the first version of this paragraph was not.
 * It said: `location` here is overwhelmingly react-router's `useLocation()` result — 22
 * reads of `location.pathname` in components, hooks and tests — and "a name-matching rule
 * would report all of them". THAT IS MEASURABLY FALSE. Force `isUnresolvedGlobal` to
 * `return true` (pure name matching) and `npm run lint` on this tree is rc=0 with ZERO
 * findings (WIC-2173). The rule only visits `AssignmentExpression` and `CallExpression`, so
 * a *read* never reaches `isWindowLocation` under any resolution strategy. Those 22 sites
 * are excluded by READS ARE NOT WRITES below, not by scope analysis.
 *
 * ON THE FIGURE, because the first correction of it was also wrong: `git grep -o
 * 'location\.pathname' -- packages/web/src` returns 35, but that is an OCCURRENCE count, not
 * a read count. It sweeps in this test file's own write fixtures — the very sites the rule
 * DOES flag — plus prose lines, two of which are the false sentence being corrected here.
 * Hand-classified, the tree has 22 genuine reads across 11 files, and that figure is
 * identical on `main` and on this branch. Never restate the raw grep total as a read count.
 *
 * The real justification is narrower and sharper: scope analysis is what separates the
 * global from a local binding named `location` that is *written to*, or that has
 * `assign`/`replace` CALLED on it. The last is an ordinary idiom rather than a contrivance —
 * a local string named `location` with `location.replace(/^\//, '')` is String.replace, not
 * navigation, and a name-matching rule flags it. That complementary pair is pinned in the
 * test file; it is the case that actually distinguishes the two implementations on realistic
 * source, and it is why the existing mutant matrix (which reds only writes on local
 * bindings) proves the scope analysis is pinned BY THE SUITE rather than needed by the tree.
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
 *   - A CHAINED object expression: `window.document.location.href = …`, `window.top.location
 *     .href = …`. The object list below is matched one level deep — a bare `window` /
 *     `globalThis` / `self` / `document` identifier — so anything reached through a further
 *     member access is the alias gap above in another spelling. `window.top.location` is
 *     additionally a different document (the top frame), which the router cannot reach at
 *     all. Both were unlisted until WIC-2173 measured them; zero sites on `main`.
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
 * Objects whose `.location` IS the DOM's `window.location`.
 *
 * `document.location` is a documented alias for `window.location` — the same object, not a
 * copy — and is a more common spelling in the wild than either `globalThis` or `self`, both
 * of which were accepted from the start. Omitting it was an oversight rather than a design
 * line, so WIC-2173 closes it. Zero sites on `main`, so the rule stays at zero findings.
 *
 * Matched one level deep only; `window.document.location` is the chained gap in KNOWN GAPS.
 */
const LOCATION_OBJECTS = ['window', 'globalThis', 'self', 'document'];

/**
 * Is `node` the DOM's `window.location`?
 *
 * Accepts two spellings:
 *   - `<object>.location`, where `<object>` is one of LOCATION_OBJECTS and itself resolves
 *     to the global; and
 *   - a bare `location`, but ONLY when it resolves to no declaration — the DOM global.
 *
 * The second clause is what keeps a local binding named `location` out of the rule —
 * react-router's `const location = useLocation()`, a `location` parameter, or a local
 * string. Those resolve to a variable with a definition, so they are rejected here.
 * (Note this is about WRITES and `assign`/`replace` calls only; reads of any spelling never
 * reach this function, because the rule visits no read position. See the docstring above.)
 */
function isWindowLocation(node, scope) {
  if (!node) return false;

  // `window.location` (or `globalThis.` / `self.` / `document.location`).
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === 'location' &&
    node.object.type === 'Identifier' &&
    LOCATION_OBJECTS.includes(node.object.name) &&
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

      // `hash` is the one member of NAVIGATING_PROPERTIES that does NOT reload, so it does
      // not get the shared message. A hash write fires `hashchange` and scrolls; the
      // document, the bundle and the React Query cache all survive it. It stays in scope
      // because it still sets the URL behind the router's back, but saying it "reloads the
      // whole document" was simply untrue — and it was untrue in permanent text, which is
      // what WIC-2173 was filed to fix. Claim only what a hash write actually does.
      hashNavigation:
        'Writing to `{{expression}}` sets the URL from outside the router. Unlike the other `location` writes this one does NOT reload the document — a hash write fires `hashchange` and scrolls — but it still moves the URL out from under react-router, which owns it in this app. Use `navigate({{suggestion}})` from `useNavigate()`, or a `<Link to={{suggestion}}>`. If you want in-page scrolling rather than navigation, scroll the target element directly and add an `eslint-disable-next-line local/no-reload-navigation` above this line saying so (WIC-2173).',
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
            // Only `hash` avoids the reload; every other property in the set tears the
            // document down. See the `messages` block.
            messageId: left.property.name === 'hash' ? 'hashNavigation' : 'reloadNavigation',
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
