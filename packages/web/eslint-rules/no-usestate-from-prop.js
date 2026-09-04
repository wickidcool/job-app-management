/**
 * ESLint rule: no-usestate-from-prop
 *
 * Flags `useState` initialisers that copy a prop's value into component state. The
 * initialiser runs on mount only, so the state is a snapshot: the parent goes on updating
 * the prop and the component keeps its mount-time copy, with nothing reporting the
 * divergence. Two writers, one value, and the visible one loses.
 *
 * This is not hypothetical here. WIC-1612 / PR #211 deleted four such sites from
 * `FilterPanel.tsx`, and WIC-1583 rewrote `OutreachComposer.tsx` after a second platform
 * picker wrote to a value the composer read once and then ignored.
 *
 * THE EXEMPTION IS THE REPO'S OWN CONVENTION, NOT AN ALLOWLIST (WIC-1583).
 * A prop whose name begins `initial` declares the mount-only contract in the name, which
 * is the decision `main` already made: `OutreachComposer`'s seed prop was renamed
 * `initialContext` and its mount-only semantics documented as deliberate
 * (OutreachComposer.tsx:14-23). So the rule adopts the convention rather than
 * re-litigating it. There is deliberately NO `allow` option: WIC-1440 measured 6 of 8
 * entries in this repo's previous rule-level allowlist going dead within two merges, and
 * a name-based exemption cannot go stale the same way — it is checked against the source,
 * every run.
 *
 * KNOWN GAPS — each is pinned by a case in src/test/useStateFromProp-rule.test.ts with a
 * differential control, so none of them is prose that nothing checks:
 *
 *   - BOOLEAN-PREDICATE SEEDS ARE OUT OF SCOPE, DELIBERATELY. `useState(!!prop)`,
 *     `useState(prop === 0)`, `useState(Boolean(prop))`. The state is not a copy of the
 *     prop — it is a user- or timer-owned boolean whose DEFAULT was conditioned on the
 *     prop — so "the prop and the state have silently diverged" has no reading: the
 *     boolean can be false while the prop is set, and that is a legitimate state, not a
 *     stale copy. Both sites in this tree are this shape (see the header note below), and
 *     in both the prop is read live elsewhere in the component, so the `initial` naming
 *     convention is structurally unavailable to them. This is a real narrowing with a
 *     real cost: a default genuinely conditioned on a prop that later changes will not be
 *     caught. A lint rule at the component definition cannot tell that apart from a
 *     deliberate default, so the narrowing is stated rather than hidden.
 *   - A prop laundered through an intermediate local: `const seed = company;
 *     useState(seed)`. The rule reads references inside the initialiser expression only,
 *     so one assignment defeats it.
 *   - Components wrapped in `memo()` or `forwardRef()`. Zero in `src/**` today (measured:
 *     `grep -rn 'memo(\|forwardRef' src/` is empty), so this is not built on spec.
 *   - Hooks and components taking POSITIONAL params rather than a destructured object —
 *     `useDebounce(value, delay)` seeds `useState(value)` at useDebounce.ts:12. That one
 *     is CORRECT: it resyncs in an effect, which is the whole point of a debounce. Since
 *     the correct and incorrect uses of the positional shape are indistinguishable to
 *     this rule, it does not look at them.
 *   - A nested component reading its PARENT's props. The rule resolves against the
 *     nearest enclosing function only. Zero in `src/**` today.
 *   - `useReducer` / `useRef` seeded from a prop. Zero `useReducer` in `src/**` today.
 *
 * THE SHAPE THIS RULE DOES HANDLE, and why that is measured rather than assumed: every
 * component in `src/**` destructures its props in the parameter list. 83 are
 * `function Name({ ... })`; exactly one is an arrow, the nested `SortIndicator` at
 * CatalogBrowseTable.tsx:35. Both shapes are handled, and both are pinned by a test, so
 * the arrow case is covered by measurement rather than by speculation.
 *
 * WHY THIS FILE'S TESTS ARE SYNTHETIC (WIC-1903). This rule lands at zero findings on
 * `main` by design, which puts it in exactly the failure mode WIC-1903 found in
 * `no-literal-caps-jsx-text`: no-op its single `context.report(...)` and the tree-property
 * test was still green, so a rule that reported NOTHING AT ALL and a working one were
 * indistinguishable. `src/test/useStateFromProp-rule.test.ts` therefore lints synthetic
 * snippets through the real resolved config and asserts both directions. A test that only
 * asserts "the tree is clean" would be worthless here.
 *
 * Source of record: WIC-1618 (this rule) / WIC-1583 (the `initial` convention) /
 * WIC-1612 (the FilterPanel sites, and why a resync effect is not the fix) /
 * WIC-1440 (why there is no allowlist) / WIC-1903 (why the tests are synthetic).
 */

/** Comparison operators — a comparison yields a boolean, never the prop's value. */
const COMPARISON_OPERATORS = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=']);

/** `useState` / `React.useState`, and nothing else. */
function isUseStateCallee(callee) {
  if (callee.type === 'Identifier') return callee.name === 'useState';
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'useState'
  );
}

/**
 * A prop name that declares its own mount-only contract (WIC-1583).
 * `initialContext` and `initialValue` match; `initialize` does not, because the character
 * after `initial` must start a new word.
 */
function declaresInitialContract(name) {
  return /^initial([A-Z0-9_]|$)/.test(name);
}

/**
 * `useState(() => expr)` is the lazy form of `useState(expr)` — same mount-only
 * semantics, same hazard. Unwrap it so the two spellings are treated alike.
 */
function unwrapLazyInitialiser(node) {
  if (
    (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') &&
    node.params.length === 0 &&
    node.body.type !== 'BlockStatement'
  ) {
    return node.body;
  }
  return node;
}

/**
 * Is the whole initialiser a boolean coercion or comparison over its operands?
 * See KNOWN GAPS: such a seed is a predicate, not a copy, so it is out of scope.
 */
function isBooleanPredicate(node) {
  if (node.type === 'UnaryExpression' && node.operator === '!') return true;
  if (node.type === 'BinaryExpression' && COMPARISON_OPERATORS.has(node.operator)) return true;
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'Boolean'
  );
}

/**
 * The nearest enclosing function. React requires a hook call to sit directly in a
 * component or hook body, so the nearest function IS the component — the rule does not
 * keep walking outward, which is what keeps a nested component from resolving against its
 * parent's props (a KNOWN GAP above).
 */
function nearestEnclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      current.type === 'FunctionDeclaration' ||
      current.type === 'FunctionExpression' ||
      current.type === 'ArrowFunctionExpression'
    ) {
      return current;
    }
  }
  return null;
}

/** The component's name, for both `function Name(...)` and `const Name = (...) => ...`. */
function componentName(fn) {
  if (fn.id && fn.id.type === 'Identifier') return fn.id.name;
  const parent = fn.parent;
  if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
    return parent.id.name;
  }
  return null;
}

/**
 * Map every binding introduced by the props ObjectPattern to the ROOT prop key it came
 * from, so `{ initialContext: { company } }` reports `company` as belonging to the
 * `initialContext` prop and takes that prop's exemption.
 */
function collectPropBindings(pattern) {
  const bindings = new Map();

  const walkValue = (value, rootKey) => {
    if (!value) return;
    switch (value.type) {
      case 'Identifier':
        bindings.set(value.name, rootKey);
        break;
      case 'AssignmentPattern':
        walkValue(value.left, rootKey);
        break;
      case 'ObjectPattern':
        for (const property of value.properties) {
          if (property.type === 'RestElement') walkValue(property.argument, rootKey);
          else walkValue(property.value, rootKey);
        }
        break;
      case 'ArrayPattern':
        for (const element of value.elements) walkValue(element, rootKey);
        break;
      default:
        break;
    }
  };

  for (const property of pattern.properties) {
    if (property.type === 'RestElement') {
      walkValue(property.argument, property.argument.name ?? '...rest');
      continue;
    }
    const key = property.key.type === 'Identifier' ? property.key.name : String(property.key.value);
    walkValue(property.value, key);
  }

  return bindings;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow seeding `useState` from a prop unless the prop name declares the mount-only contract by starting with `initial`.',
    },
    // No options, deliberately. See the `allow`-list note in the header (WIC-1440).
    schema: [],
    messages: {
      useStateFromProp:
        '`useState` seeds `{{state}}` from the `{{prop}}` prop, so the initialiser runs on mount only and every later change to `{{prop}}` is silently dropped — the parent moves on while this component keeps its mount-time copy. Either derive the value during render instead of copying it into state, or, if the snapshot is genuinely wanted, rename the prop to `initial{{Prop}}` so the contract is in the name and remount on change with a `key` (the WIC-1583 convention — see OutreachComposer.tsx and its caller OutreachNew.tsx). Do NOT add a resync effect: `react-hooks/set-state-in-effect` rejects it (WIC-1612).',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    return {
      CallExpression(node) {
        if (!isUseStateCallee(node.callee) || node.arguments.length === 0) return;

        const initialiser = unwrapLazyInitialiser(node.arguments[0]);

        // A predicate over the props is not a copy of them — see KNOWN GAPS.
        if (isBooleanPredicate(initialiser)) return;

        const fn = nearestEnclosingFunction(node);
        if (!fn || fn.params.length === 0 || fn.params[0].type !== 'ObjectPattern') return;

        // Components only. A lowercase name is a plain function or a custom hook, whose
        // positional-param shape this rule deliberately does not read (KNOWN GAPS).
        const name = componentName(fn);
        if (!name || !/^[A-Z]/.test(name)) return;

        const scope = sourceCode.scopeManager.acquire(fn);
        if (!scope) return;

        const bindings = collectPropBindings(fn.params[0]);

        // Resolve through scope analysis rather than by matching names: a local that
        // shadows a prop resolves to its own variable and is correctly ignored, and a
        // reference that resolves to the prop is a genuine read however it is spelled.
        const [start, end] = initialiser.range;
        const referencedProps = new Set();
        for (const variable of scope.variables) {
          if (!bindings.has(variable.name)) continue;
          if (!variable.defs.some((def) => def.type === 'Parameter' && def.node === fn)) continue;
          for (const reference of variable.references) {
            const [refStart, refEnd] = reference.identifier.range;
            if (refStart >= start && refEnd <= end) {
              referencedProps.add(bindings.get(variable.name));
              break;
            }
          }
        }

        if (referencedProps.size === 0) return;

        // Every prop reached by the initialiser must declare the contract. A mixed
        // initialiser — one `initial*` prop and one ordinary one — still drops the
        // ordinary prop's updates, so it is not exempt.
        const offending = [...referencedProps].filter((prop) => !declaresInitialContract(prop));
        if (offending.length === 0) return;

        // The state variable's name, for a report that names the thing to look at.
        const declarator = node.parent;
        let state = 'state';
        if (
          declarator &&
          declarator.type === 'VariableDeclarator' &&
          declarator.id.type === 'ArrayPattern' &&
          declarator.id.elements[0] &&
          declarator.id.elements[0].type === 'Identifier'
        ) {
          state = declarator.id.elements[0].name;
        }

        const prop = offending[0];
        context.report({
          node,
          messageId: 'useStateFromProp',
          data: { state, prop, Prop: prop.charAt(0).toUpperCase() + prop.slice(1) },
        });
      },
    };
  },
};
