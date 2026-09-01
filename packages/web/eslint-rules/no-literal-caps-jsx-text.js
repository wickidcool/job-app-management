/**
 * ESLint rule: no-literal-caps-jsx-text
 *
 * Flags literal ALL-CAPS strings written directly into JSX text nodes, because a caps
 * string in the source is a caps string in the accessibility tree — and some screen
 * readers (VoiceOver notably) spell short all-caps strings out letter by letter.
 *
 * Normative reference: docs/design/COMPONENT_SPECS.md §"Reading the wireframes: casing"
 * (lines 5-24). Filed as WIC-1209, closing the WIC-1069 -> WIC-1127 -> WIC-1184 ->
 * WIC-1187 -> WIC-1195 -> WIC-1205 -> WIC-1228 chain of hand-enumerated sweeps.
 *
 * What is CORRECT and must not be flagged: mixed-case source plus a CSS `uppercase`
 * class. The caps are rendered visually and never reach the accessibility tree. See
 * pages/ResumeVariantDetail.tsx (the "Summary"/"Skills"/"Experience" headings) — the
 * model case, and the exact thing three prior tickets nearly "fixed" into a regression.
 *
 * KNOWN GAPS — this is a JSX *text node* rule and cannot see:
 *   - Runtime `.toUpperCase()` calls (e.g. JobFitAnalysis.tsx, owned by WIC-1122/1146).
 *   - Caps inside attribute values such as `aria-label={`${x} ACTION`}`, which are
 *     unreachable from CSS and were ChangeActionBadge's worst instance (WIC-1185).
 *   - Caps in strings that reach JSX through a variable or a config object.
 *   - Caps containing `$` — see the CAPS_PATTERN note below.
 * Widening to those is deliberately deferred; see WIC-1209 / WIC-1192.
 *
 * Every claim above about what this rule does and does not catch is pinned by
 * src/test/caps-rule.test.ts, which lints synthetic snippets through the real resolved
 * config. That file is the only thing standing between a silently-dead rule and a green
 * CI run — caps-baseline.test.ts cannot tell the two apart (WIC-1903).
 */

// Per WIC-1209 / §5b of WIREFRAME_CASING_TRIAGE_WIC1195.md, widened by WIC-1262.
//
// The original class admitted only space, `&`, `:`, `'` and `-`, so any other
// punctuation dropped the string out of the rule entirely — a single trailing period
// was enough, and 8 of 9 realistic shouted headings escaped. The punctuation below is
// the measured closure of that gap; it adds no false positive anywhere in `src/**`.
//
// `-` is written first so it cannot form a range; the two dashes are spelled as `\u`
// escapes because en dash and em dash are indistinguishable by eye in source.
const CAPS_PATTERN = /^[A-Z][-A-Z0-9 &:'?!.,()/\u2013\u2014]{3,}$/;
// `$` is deliberately NOT in the class: it risks matching currency-and-caps fragments,
// and `SALARY: $120K RANGE` is rarer than the punctuation cases (WIC-1262). The gap is
// pinned as a test case rather than left implicit, so widening it is a deliberate act.

// Guard against noise like "A & B" / "A - B": require a real caps word somewhere.
const HAS_CAPS_WORD = /[A-Z]{2,}/;

// Genuinely uppercase words. Letter-by-letter announcement is the correct reading for
// these, so `.toUpperCase()` / literal caps on them is deliberate and stays green.
const ACRONYMS = new Set([
  'AI',
  'API',
  'ATS',
  'AWS',
  'CSV',
  'DOCX',
  'HTML',
  'ID',
  'JSON',
  'ML',
  'PDF',
  'PII',
  'RTF',
  'SQL',
  'STAR',
  'TXT',
  'UI',
  'URL',
  'UX',
  'XML',
]);

/** Every word is an allowlisted acronym -> not a shouted label. */
function isAllAcronyms(text) {
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => ACRONYMS.has(w));
}

/**
 * Does this element — or any JSX ancestor — carry a CSS `uppercase` class?
 * `text-transform` inherits, so an ancestor's class is what makes a nested literal
 * render in caps, and checking only the immediate element produces false positives.
 * Reads string literals and the static (quasi) parts of template literals; that covers
 * every className shape in this codebase today.
 */
function hasUppercaseClass(node) {
  for (let el = node; el; el = el.parent) {
    if (el.type !== 'JSXElement') continue;
    const opening = el.openingElement;
    if (!opening) continue;
    for (const attr of opening.attributes) {
      if (attr.type !== 'JSXAttribute' || !attr.name) continue;
      const name = attr.name.name;
      if (name !== 'className' && name !== 'class') continue;
      if (classValueHasUppercase(attr.value)) return true;
    }
  }
  return false;
}

function classValueHasUppercase(value) {
  if (!value) return false;
  if (value.type === 'Literal') {
    return typeof value.value === 'string' && /(^|[\s:])uppercase(\s|$)/.test(value.value);
  }
  if (value.type === 'JSXExpressionContainer') {
    // Cheap and deliberately over-permissive: if the word `uppercase` appears anywhere
    // in the expression's static text, treat the element as CSS-uppercased. A missed
    // finding here is far cheaper than a false positive that pressures someone into
    // "fixing" a correct R1-pattern heading.
    return expressionMentionsUppercase(value.expression);
  }
  return false;
}

function expressionMentionsUppercase(expr) {
  if (!expr) return false;
  if (expr.type === 'Literal') {
    return typeof expr.value === 'string' && expr.value.includes('uppercase');
  }
  if (expr.type === 'TemplateLiteral') {
    // Both halves matter: `text-xs ${cond ? 'uppercase' : ''}` carries the class in the
    // interpolated expression, not the static quasi. Checking quasis alone produced a
    // false positive on exactly that shape.
    return (
      expr.quasis.some((q) => q.value.raw.includes('uppercase')) ||
      expr.expressions.some((e) => expressionMentionsUppercase(e))
    );
  }
  if (expr.type === 'ConditionalExpression') {
    return (
      expressionMentionsUppercase(expr.consequent) || expressionMentionsUppercase(expr.alternate)
    );
  }
  if (expr.type === 'LogicalExpression' || expr.type === 'BinaryExpression') {
    return expressionMentionsUppercase(expr.left) || expressionMentionsUppercase(expr.right);
  }
  if (expr.type === 'CallExpression') {
    return expr.arguments.some((a) => expressionMentionsUppercase(a));
  }
  if (expr.type === 'ArrayExpression') {
    return expr.elements.some((e) => expressionMentionsUppercase(e));
  }
  if (expr.type === 'ObjectExpression') {
    return expr.properties.some(
      (p) => p.type === 'Property' && expressionMentionsUppercase(p.value)
    );
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow literal ALL-CAPS text in JSX text nodes; render caps with a CSS `uppercase` class so the accessible name stays normal-cased.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          // Sites still shouting on `main` because their fix is on an unmerged PR.
          // This is a SHRINKING baseline: entries are removed as the PRs land, and
          // nothing may be added to it without a linked ticket.
          allow: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      literalCaps:
        'Literal ALL-CAPS text "{{text}}" reaches the accessibility tree, where it may be spelled out letter by letter. Drop the caps in the source; if the label should still render in caps, add `uppercase tracking-wider` (eyebrow/badge). Headings and field labels take no replacement class. See docs/design/COMPONENT_SPECS.md §"Reading the wireframes: casing".',
    },
  },

  create(context) {
    const allow = new Set(context.options[0]?.allow ?? []);

    return {
      JSXText(node) {
        const text = node.value.trim();
        if (!text) return;
        if (!CAPS_PATTERN.test(text) || !HAS_CAPS_WORD.test(text)) return;
        if (isAllAcronyms(text)) return;
        if (allow.has(text)) return;
        if (hasUppercaseClass(node.parent)) return;

        context.report({ node, messageId: 'literalCaps', data: { text } });
      },
    };
  },
};
