import { computeAccessibleName } from 'dom-accessibility-api';
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
 * The assertion that matters is that those two readings are now **identical** — not that
 * some particular attribute is present. Asserting on the markup would pass again the
 * moment someone reintroduces the attribute in a different shape.
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
  return screen.getByLabelText(/Situation:/i) as HTMLTextAreaElement;
}

describe('STARInput validity tick — ARIA prohibited name (WIC-1191)', () => {
  it('gives the textarea the same accessible name whether or not a prohibited name is honoured', () => {
    const { container } = render(
      <STARInput value={filled({ situation: 'x'.repeat(MIN_LENGTH) })} onChange={() => {}} />
    );

    const honoured = computeAccessibleName(situationField());

    // Now model the conformant AT that ignores a prohibited author name.
    dropProhibitedNames(container);
    const dropped = computeAccessibleName(situationField());

    expect(dropped).toBe(honoured);
  });

  it('never lets the decorative ✓ glyph into the field accessible name', () => {
    const { container } = render(
      <STARInput value={filled({ situation: 'x'.repeat(MIN_LENGTH) })} onChange={() => {}} />
    );

    expect(computeAccessibleName(situationField())).not.toContain('✓');

    dropProhibitedNames(container);
    expect(computeAccessibleName(situationField())).not.toContain('✓');
  });

  it('announces validity as real text, so the state is not carried by the glyph alone', () => {
    render(<STARInput value={filled({ situation: 'x'.repeat(MIN_LENGTH) })} onChange={() => {}} />);

    expect(computeAccessibleName(situationField())).toContain('Field valid');
  });

  it('carries no author name on any role-less element', () => {
    const { container } = render(
      <STARInput value={filled({ situation: 'x'.repeat(MIN_LENGTH) })} onChange={() => {}} />
    );

    expect(elementsWithProhibitedName(container)).toEqual([]);
  });

  it('shows no validity affordance at all while the field is too short', () => {
    render(
      <STARInput value={filled({ situation: 'x'.repeat(MIN_LENGTH - 1) })} onChange={() => {}} />
    );

    const name = computeAccessibleName(situationField());
    expect(name).not.toContain('Field valid');
    expect(name).not.toContain('✓');
  });
});
