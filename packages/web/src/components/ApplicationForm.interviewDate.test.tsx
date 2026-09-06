import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApplicationForm } from './ApplicationForm';
import { applicationFormSchema } from './applicationFormSchema';
import type { Application, ApplicationFormData } from '../types/application';

/**
 * WIC-2188 — the writer for `applications.interviewDate`.
 *
 * The API half shipped in WIC-2023 and the two render sites (`InterviewPrepCard`'s countdown,
 * `QuickReferenceExport`) were already built. Everything between a `NULL` column and those
 * sites lighting up is this control, so what these cases have to prove is not "a field
 * exists" but "the value that leaves this form is the instant the user meant".
 *
 * ## `process.env.TZ` is pinned, and that is the point of the file
 *
 * The defect class here is entirely about offsets, and **every one of these assertions is
 * green in UTC against a broken implementation**: a form that shipped the raw
 * `datetime-local` value, or prefilled by slicing the ISO string, differs from a correct one
 * by exactly the local offset, which in UTC is zero. This repo pins no timezone (`TZ` appears
 * in neither `vitest.config.ts` nor `src/test/setup.ts`), so the ambient zone on CI is UTC and
 * an unpinned suite would be measuring nothing. Node re-reads `process.env.TZ` per `Date`
 * operation, so setting it in `beforeEach` is enough; `afterEach` restores the ambient value.
 *
 * `America/New_York` on 10 September 2026 is EDT (UTC−4), so `14:30` local is `18:30Z`.
 *
 * ## Why the schema is asserted directly as well as through the DOM
 *
 * A `datetime-local` control cannot emit a date-only string, so the DOM path cannot reach the
 * exact regression the card names — the UTC-midnight shift that `new Date('2026-09-10')`
 * produces. `applicationFormSchema` is the layer that would silently readmit it (swap the
 * rule for the `^\d{4}-\d{2}-\d{2}$` one its neighbour `nextActionDue` uses and the form still
 * renders, still submits, and starts shifting instants), so that layer is asserted directly.
 * The DOM cases cover the path a user actually takes; the schema cases cover the mutation.
 */

const AMBIENT_TZ = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'America/New_York';
});

afterEach(() => {
  if (AMBIENT_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = AMBIENT_TZ;
});

const STORED_INSTANT = '2026-09-10T18:30:00.000Z';
const LOCAL_WALL_CLOCK = '2026-09-10T14:30';

function existingApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app_1',
    jobTitle: 'Staff Engineer',
    company: 'Acme',
    status: 'interview',
    hasDocuments: false,
    version: 3,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** Render in create or edit mode and hand back the submit spy. */
function renderForm(application?: Application) {
  const onSubmit = vi.fn<(data: ApplicationFormData) => Promise<void>>(async () => {});
  render(
    <ApplicationForm
      open
      onOpenChange={() => {}}
      onSubmit={onSubmit}
      application={application}
      mode={application ? 'edit' : 'create'}
    />
  );
  return { onSubmit };
}

const interviewDateInput = () => screen.getByLabelText(/interview date/i) as HTMLInputElement;

/** The one payload `onSubmit` was called with. Fails loudly on 0 or 2+ calls. */
function soleSubmission(onSubmit: { mock: { calls: unknown[][] } }): ApplicationFormData {
  expect(onSubmit.mock.calls).toHaveLength(1);
  return onSubmit.mock.calls[0][0] as ApplicationFormData;
}

describe('ApplicationForm — the interview date control (WIC-2188)', () => {
  it('renders a labelled `datetime-local` control, not a `date` one', () => {
    renderForm();
    const input = interviewDateInput();

    // The type is the acceptance criterion, not a styling detail: `type="date"` emits
    // `2026-09-10`, which the API rejects outright, and which is the obvious implementation.
    expect(input.type).toBe('datetime-local');
    expect(input).toHaveAccessibleName('Interview Date & Time');
  });

  it('submits an ISO instant with an offset, converted from the local wall clock', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/job title/i), 'Staff Engineer');
    await user.type(screen.getByLabelText(/^company/i), 'Acme');
    await user.type(interviewDateInput(), LOCAL_WALL_CLOCK);
    await user.click(screen.getByRole('button', { name: /save application/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    // Not `expect.stringContaining('2026-09-10')` — the whole question is which instant, and
    // a substring on the date part is satisfied by the untransformed control value too.
    expect(soleSubmission(onSubmit).interviewDate).toBe(STORED_INSTANT);
  });

  it('leaves the field absent-but-empty when the user does not schedule anything', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();

    await user.type(screen.getByLabelText(/job title/i), 'Staff Engineer');
    await user.type(screen.getByLabelText(/^company/i), 'Acme');
    await user.click(screen.getByRole('button', { name: /save application/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(soleSubmission(onSubmit).interviewDate).toBe('');
  });

  it('prefills edit mode with the stored instant rendered in LOCAL time', () => {
    renderForm(existingApplication({ interviewDate: STORED_INSTANT }));

    // `18:30` here would be the ISO-slice implementation: a value the control displays
    // perfectly happily, four hours after the interview the user scheduled.
    expect(interviewDateInput().value).toBe(LOCAL_WALL_CLOCK);
    expect(interviewDateInput().value).not.toBe(STORED_INSTANT.slice(0, 16));
  });

  it('prefills an empty control when no interview is scheduled', () => {
    renderForm(existingApplication({ interviewDate: undefined }));
    expect(interviewDateInput().value).toBe('');
  });

  it('round-trips an untouched edit without moving the instant', async () => {
    // The regression a prefill bug causes even when the user never touches this field: open,
    // change something else, save, and the interview silently slides by one offset each time.
    const user = userEvent.setup();
    const { onSubmit } = renderForm(existingApplication({ interviewDate: STORED_INSTANT }));

    await user.type(screen.getByLabelText(/contact/i), 'Jane Smith');
    await user.click(screen.getByRole('button', { name: /save application/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(soleSubmission(onSubmit).interviewDate).toBe(STORED_INSTANT);
  });

  it('CLEARS a previously-set date by submitting `""`, not by omitting the field', async () => {
    // `''` and `undefined` are different requests to the API. The update route maps `''` to
    // `undefined` while leaving the key present, and `application.service.ts` writes `NULL`
    // on `'interviewDate' in input`. Omit the key instead and the stored date survives, so a
    // payload that merely lacks the field is a cleared control that did not clear anything.
    const user = userEvent.setup();
    const { onSubmit } = renderForm(existingApplication({ interviewDate: STORED_INSTANT }));

    await user.clear(interviewDateInput());
    expect(interviewDateInput().value).toBe('');

    await user.click(screen.getByRole('button', { name: /save application/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    const submitted = soleSubmission(onSubmit);
    expect(submitted.interviewDate).toBe('');
    expect('interviewDate' in submitted).toBe(true);
  });
});

describe('applicationFormSchema — the interview date rule (WIC-2188)', () => {
  const base = { jobTitle: 'Staff Engineer', company: 'Acme', status: 'interview' as const };

  const parse = (interviewDate: string) =>
    applicationFormSchema.safeParse({ ...base, interviewDate });

  it('REJECTS a date-only string — the UTC-midnight regression', () => {
    // Swap this rule for the `^\d{4}-\d{2}-\d{2}$` one `nextActionDue` uses and this is the
    // assertion that goes red. Everything else about the form keeps working.
    const result = parse('2026-09-10');

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['interviewDate']);
    expect(result.error?.issues[0].message).toMatch(/not a date alone/i);
  });

  it('positive control: the same instant WITH a time is accepted', () => {
    // Without this, the case above passes just as well against a rule that rejects
    // everything — including every value a real user can enter.
    const result = parse('2026-09-10T14:30');

    expect(result.success).toBe(true);
    expect(result.data?.interviewDate).toBe(STORED_INSTANT);
  });

  it('accepts the empty string and passes it through untransformed', () => {
    const result = parse('');
    expect(result.success).toBe(true);
    expect(result.data?.interviewDate).toBe('');
  });

  it('accepts the field being absent entirely', () => {
    const result = applicationFormSchema.safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data?.interviewDate).toBeUndefined();
  });

  it('rejects a value that is not a real date and time', () => {
    expect(parse('2026-13-01T10:00').success).toBe(false);
    expect(parse('2026-09-10T25:00').success).toBe(false);
  });

  it('rejects an instant handed back in as if it were a control value', () => {
    // Double-conversion guard. If this were accepted, `dateTimeLocalToInstant` would read the
    // `18:30` digits as local and shift the instant again on every save.
    expect(parse(STORED_INSTANT).success).toBe(false);
  });

  it('produces an output the API `datetime({ offset: true })` rule accepts', () => {
    // The contract this schema has to meet, restated in the API's own vocabulary rather than
    // as a hand-written regex, so the two cannot drift apart on a technicality.
    const apiRule = z.string().datetime({ offset: true }).or(z.literal(''));

    expect(apiRule.safeParse(parse('2026-09-10T14:30').data?.interviewDate).success).toBe(true);
    expect(apiRule.safeParse(parse('').data?.interviewDate).success).toBe(true);
    // ...and refuses the raw control value, which is why the transform has to exist.
    expect(apiRule.safeParse('2026-09-10T14:30').success).toBe(false);
    expect(apiRule.safeParse('2026-09-10').success).toBe(false);
  });
});
