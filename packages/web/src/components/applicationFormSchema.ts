import { z } from 'zod';

import { dateTimeLocalToInstant, isDateTimeLocalValue } from '../utils/datetimeLocal';

/**
 * Validation for `ApplicationForm`.
 *
 * Lifted out of `ApplicationForm.tsx` by WIC-2188. Not a tidy-up: `interviewDate` is the
 * first field on this form whose rule *transforms* rather than merely validating — what the
 * control holds and what a submit handler receives are different strings — so the schema
 * became something worth asserting on directly, and a component module cannot export it
 * (`react-refresh/only-export-components` is an error in this package, and it is right to
 * be: a non-component export from a component file breaks fast refresh).
 *
 * `ApplicationForm.interviewDate.test.tsx` exercises both this module and the rendered
 * control, because the two can fail apart: the DOM path cannot reach a date-only string (no
 * `datetime-local` control emits one) and the schema path cannot see a prefill bug.
 */
// Zod validation schema based on component specs
export const applicationFormSchema = z.object({
  jobTitle: z
    .string()
    .min(2, 'Job title must be at least 2 characters')
    .max(200, 'Job title must be less than 200 characters'),
  company: z
    .string()
    .min(2, 'Company name must be at least 2 characters')
    .max(100, 'Company name must be less than 100 characters'),
  url: z
    .string()
    .regex(/^https?:\/\/.+/, 'Must be a valid URL starting with http:// or https://')
    .optional()
    .or(z.literal('')),
  location: z.string().optional(),
  salaryRange: z.string().optional(),
  jobDescription: z
    .string()
    .max(10000, 'Job description must be less than 10,000 characters')
    .optional(),
  status: z.enum([
    'saved',
    'applied',
    'phone_screen',
    'interview',
    'offer',
    'rejected',
    'withdrawn',
  ]),
  linkCoverLetter: z.boolean().optional(),
  coverLetterId: z.string().optional(),
  // UC-5 Extended Tracking Fields
  contact: z.string().max(200, 'Contact must be less than 200 characters').optional(),
  compTarget: z.string().optional(),
  nextAction: z.string().max(500, 'Next action must be less than 500 characters').optional(),
  nextActionDue: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
    .optional()
    .or(z.literal('')),
  /*
   * WIC-2188. Do NOT copy the `nextActionDue` rule directly above. These two fields look
   * alike on the form and have different contracts:
   *
   *   nextActionDue  DATE          `^\d{4}-\d{2}-\d{2}$`               a calendar day
   *   interviewDate  TIMESTAMPTZ   `z.string().datetime({ offset: true })`   an instant
   *
   * So this rule does two things the sibling does not. It requires a *time* — the control is
   * `datetime-local`, and its value carries no offset, so `2026-09-10` and `2026-09-10T14:30`
   * are both things `new Date` accepts but only the second one means what the user typed
   * (the first is read as UTC midnight, which for anyone west of Greenwich is the previous
   * evening). And it *transforms*, so what leaves this form is the ISO-with-offset string the
   * API validates rather than the browser-local one the DOM holds.
   *
   * The empty string passes through untouched: it is the "no interview scheduled" value, and
   * on an update it is what clears a previously-stored date.
   */
  interviewDate: z
    .string()
    .optional()
    .refine(
      (v) => !v || isDateTimeLocalValue(v),
      'Enter an interview date and time, not a date alone'
    )
    .refine(
      (v) => !v || !isDateTimeLocalValue(v) || dateTimeLocalToInstant(v) !== null,
      'That is not a real date and time'
    )
    .transform((v) => (v ? (dateTimeLocalToInstant(v) as string) : v)),
});

/**
 * The submit payload this form produces, i.e. `applicationFormSchema`'s **output**.
 *
 * Exported for tests. `interviewDate` is the reason it is worth naming: its input type
 * (what the `datetime-local` input holds) and its output type (what a submit handler is
 * handed) are both `string | undefined` but are not the same strings, and pinning the
 * output shape is how a test asserts the conversion happened rather than asserting the DOM.
 */
export type ApplicationFormValues = z.output<typeof applicationFormSchema>;
