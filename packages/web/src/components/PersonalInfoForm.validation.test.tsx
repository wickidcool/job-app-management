import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { PersonalInfoForm } from './PersonalInfoForm';
import type { PersonalInfo } from '../services/api/types';

/**
 * Regression cover for WIC-2126.
 *
 * `packages/web` declared `zod@^3.23.8` while the committed lockfile installed a nested
 * `zod@4.3.6` under `packages/web/node_modules`, alongside `@hookform/resolvers@3.10.0`.
 * Vite and node both resolve from the importing file upward, so every component here got
 * zod 4 while the resolver only understood zod 3's `ZodError` shape. Its error guard
 * missed, so an invalid submit **rethrew** instead of populating `formState.errors`:
 * no message, no save, no feedback of any kind, on both `zodResolver` call sites.
 *
 * It survived unnoticed because native constraint validation masked it. The URL and email
 * inputs are `type="url"` / `type="email"`, so the browser blocked submission before React
 * Hook Form was ever reached and the field *looked* rejected. The mask lifted only for a
 * field that fails in Zod alone — a required-but-empty `linkedinUrl`, which is exactly what
 * `assertsTheZodMessageRenders` below drives. Neither form had a vitest test at all.
 *
 * Two layers are asserted deliberately, because they fail independently:
 *
 *   1. the resolver contract itself — the tightest detector of a zod/resolvers version
 *      skew, and the one that does not need a render to catch it;
 *   2. the rendered form — proof that the message actually reaches the user, which is the
 *      thing the defect took away.
 *
 * The dependency half of the fix has its own gate and is not duplicated here: `npm ls zod`
 * exits non-zero on the broken tree. A unit test cannot see two copies of a package once
 * only one is installed, so that gate is the guard against the *cause*, and this file is
 * the guard against the *symptom*.
 */

// Deliberately not cast to `PersonalInfo` — an `as` here would let the fixture drift out
// of shape with the real type and still compile, which is the same class of silent skew
// this file exists to catch.
const VALID: PersonalInfo = {
  id: 'pi_1',
  firstName: 'Alex',
  lastName: 'Johnson',
  email: 'alex@example.com',
  phone: '(555) 123-4567',
  addressLine1: '123 Main St',
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94102',
  country: 'USA',
  linkedinUrl: 'https://linkedin.com/in/alexjohnson',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
};

describe('zodResolver contract (WIC-2126)', () => {
  it('maps a validation failure to `errors` instead of throwing', async () => {
    const schema = z.object({
      linkedinUrl: z.string().min(1, 'LinkedIn URL is required').url(),
    });

    // Against the defect this call REJECTS with a `ZodError`, so awaiting it fails the
    // test outright rather than reaching any assertion below.
    const result = await zodResolver(schema)({ linkedinUrl: '' }, undefined, {
      fields: {},
      shouldUseNativeValidation: false,
    });

    expect(result.errors).toMatchObject({
      linkedinUrl: { message: 'LinkedIn URL is required' },
    });
  });

  it('returns the parsed values when input is valid (positive control)', async () => {
    const schema = z.object({ linkedinUrl: z.string().url() });

    const result = await zodResolver(schema)(
      { linkedinUrl: 'https://linkedin.com/in/alexjohnson' },
      undefined,
      { fields: {}, shouldUseNativeValidation: false }
    );

    // Without this, the assertion above passes just as happily against a resolver that
    // reports every input invalid.
    expect(result.errors).toEqual({});
    expect(result.values).toEqual({ linkedinUrl: 'https://linkedin.com/in/alexjohnson' });
  });
});

describe('PersonalInfoForm — client-side validation messaging (WIC-2126)', () => {
  it('renders the Zod message when a required field is cleared, and does not submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PersonalInfoForm personalInfo={VALID} onSubmit={onSubmit} submitLabel="Save" />);

    // Clearing also dirties the form, which is what enables the submit button.
    await user.clear(screen.getByLabelText(/linkedin url/i));
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText('LinkedIn URL is required')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('associates the message with its field for assistive technology', async () => {
    const user = userEvent.setup();
    render(<PersonalInfoForm personalInfo={VALID} onSubmit={vi.fn()} submitLabel="Save" />);

    const input = screen.getByLabelText(/linkedin url/i);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /save/i }));

    await screen.findByText('LinkedIn URL is required');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('LinkedIn URL is required');
  });

  it('submits when the form is valid (positive control)', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PersonalInfoForm personalInfo={VALID} onSubmit={onSubmit} submitLabel="Save" />);

    await user.clear(screen.getByLabelText(/^city/i));
    await user.type(screen.getByLabelText(/^city/i), 'Oakland');
    await user.click(screen.getByRole('button', { name: /save/i }));

    // Proves the submit path works at all, so the two assertions above are not passing
    // merely because nothing in this harness can ever reach `handleSubmit`.
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ city: 'Oakland' });
  });

  it('carries `noValidate`, so Zod is the only source of validation messaging', () => {
    const { container } = render(
      <PersonalInfoForm personalInfo={VALID} onSubmit={vi.fn()} submitLabel="Save" />
    );

    // jsdom does not run native constraint validation on submit, so this attribute is
    // asserted directly rather than through behaviour. In a real browser its absence is
    // what let `type="url"` / `type="email"` fields short-circuit submission with a native
    // tooltip, hiding the Zod layer for exactly the fields most likely to be typed wrong.
    expect(container.querySelector('form')).toHaveAttribute('noValidate');
  });
});
