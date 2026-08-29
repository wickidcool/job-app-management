import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { STARInput, type STARData } from './STARInput';
import { dropProhibitedNames, elementsWithProhibitedName } from '../../test/prohibitedName';

/**
 * Regression cover for WIC-1191.
 *
 * The validity tick used to render as `<span aria-label="Field valid">✓</span>` — a
 * role-less span, so ARIA `generic`, so the name is *prohibited* and may be ignored.
 * That span sits **inside the `<label>` that names the textarea**, which makes this the
 * worse variant of the WIC-1185 class: when the prohibited name is dropped, the bare
 * decorative glyph is what remains in the label, and it lands in the form control's
 * accessible name.
 *
 * Measured on the before markup:
 *
 * | | textarea accessible name |
 * |---|---|
 * | `aria-label` honoured | `"Situation: … Field valid"` |
 * | `aria-label` dropped  | `"Situation: … ✓"`          |
 *
 * The property under test is that **both readings agree**, not that some particular
 * attribute is present. Asserting on the markup (`not.toHaveAttribute('aria-label')`)
 * would go green again the moment the attribute returned in a different shape.
 *
 * Accessible names come from jest-dom's `toHaveAccessibleName`, which runs a real
 * accessible-name computation. Deliberately not `dom-accessibility-api` directly: that
 * package is only a transitive dependency here, and its `package.json` `exports` block
 * hides its own type declarations from `tsc`, so importing it breaks the build.
 */

const MIN_LENGTH = 10;

function filled(overrides: Partial<STARData> = {}): STARData {
  return {
    headline: '',
    situation: '',
    task: '',
    action: '',
    result: '',
    ...overrides,
  };
}

/** The `situation` textarea, whose label is the one carrying the tick. */
function situationField(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: /Situation:/i }) as HTMLTextAreaElement;
}

function renderValid() {
  return render(
    <STARInput value={filled({ situation: 'x'.repeat(MIN_LENGTH) })} onChange={() => {}} />
  );
}

describe('STARInput validity tick — ARIA prohibited name (WIC-1191)', () => {
  it('keeps the same accessible name whether or not a prohibited name is honoured', () => {
    const { container } = renderValid();

    expect(situationField()).toHaveAccessibleName(/Field valid/);
    expect(situationField()).not.toHaveAccessibleName(/✓/);

    // Now model the conformant AT that ignores a prohibited author name.
    dropProhibitedNames(container);

    expect(situationField()).toHaveAccessibleName(/Field valid/);
    expect(situationField()).not.toHaveAccessibleName(/✓/);
  });

  it('keeps the field label itself intact', () => {
    renderValid();

    expect(situationField()).toHaveAccessibleName(
      /Situation: What was the context or challenge you faced\?/
    );
  });

  it('carries no author name on any role-less element', () => {
    const { container } = renderValid();

    expect(elementsWithProhibitedName(container)).toEqual([]);
  });

  it('shows no validity affordance at all while the field is too short', () => {
    render(
      <STARInput value={filled({ situation: 'x'.repeat(MIN_LENGTH - 1) })} onChange={() => {}} />
    );

    expect(situationField()).not.toHaveAccessibleName(/Field valid/);
    expect(situationField()).not.toHaveAccessibleName(/✓/);
  });
});
