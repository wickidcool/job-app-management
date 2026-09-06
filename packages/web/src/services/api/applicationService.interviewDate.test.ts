import { describe, expect, it, vi } from 'vitest';

import { ApplicationService } from './applicationService';
import type { APIClient } from './apiClient';
import type { APIApplication } from './types';

/**
 * WIC-2188 — `interviewDate` has to survive the wire layer in both directions.
 *
 * `ApplicationForm` produces the right string and `InterviewPrepCard` renders the right
 * countdown, and between them sits a hand-written field-by-field mapper in three places
 * (`transformAPIApplication`, `create`, `update`). A field missing from any one of them is
 * invisible to TypeScript — every property involved is optional — so the form would submit a
 * correct instant and the request would simply not carry it.
 *
 * These are the assertions that cover that gap, and they are deliberately about the *request
 * body and the mapped object*, not about a rendered value: the failure mode is silent
 * omission, which no rendering test can distinguish from "the user did not set one".
 */

const INSTANT = '2026-09-10T18:30:00.000Z';

function apiApplication(overrides: Partial<APIApplication> = {}): APIApplication {
  return {
    id: 'app_1',
    jobTitle: 'Staff Engineer',
    company: 'Acme',
    status: 'interview',
    version: 3,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** One recorded call: the endpoint and the request body the service handed the client. */
interface SentRequest {
  endpoint: string;
  body: Record<string, unknown>;
}

/**
 * A client that records the body it was handed and echoes back a fixed application.
 *
 * The recorded bodies are collected into an array rather than read back off `mock.calls`,
 * which is what makes them typed: an argument-less `vi.fn` types `mock.calls` as `[][]`, and
 * naming the parameters only to ignore them trips `@typescript-eslint/no-unused-vars`.
 */
function recordingClient(response: APIApplication = apiApplication()) {
  const sent: SentRequest[] = [];
  const record = (endpoint: string, body: Record<string, unknown>) => {
    sent.push({ endpoint, body });
    return { application: response };
  };

  const post = vi.fn(async (endpoint: string, body: Record<string, unknown>) =>
    record(endpoint, body)
  );
  const patch = vi.fn(async (endpoint: string, body: Record<string, unknown>) =>
    record(endpoint, body)
  );
  const get = vi.fn(async (endpoint: string) => ({
    ...record(endpoint, {}),
    history: [],
  }));

  return {
    service: new ApplicationService({ post, patch, get } as unknown as APIClient),
    sent,
  };
}

/** The single request the service issued. Fails loudly on 0 or 2+. */
function soleRequest(sent: SentRequest[]): SentRequest {
  expect(sent).toHaveLength(1);
  return sent[0];
}

describe('ApplicationService — interviewDate on the wire (WIC-2188)', () => {
  it('sends the instant on create', async () => {
    const { service, sent } = recordingClient();

    await service.create({
      jobTitle: 'Staff Engineer',
      company: 'Acme',
      status: 'interview',
      interviewDate: INSTANT,
    });

    expect(soleRequest(sent).endpoint).toBe('/applications');
    expect(soleRequest(sent).body.interviewDate).toBe(INSTANT);
  });

  it('sends the instant on update', async () => {
    const { service, sent } = recordingClient();

    await service.update('app_1', { interviewDate: INSTANT }, 3);

    expect(soleRequest(sent).endpoint).toBe('/applications/app_1');
    expect(soleRequest(sent).body).toMatchObject({ interviewDate: INSTANT, version: 3 });
  });

  it('forwards `""` on update rather than collapsing it to `undefined`', async () => {
    // The clear request. `''` and `undefined` mean opposite things to the update route --
    // `''` maps to a key-present `undefined` and writes NULL, while an absent key leaves the
    // stored date alone -- so a mapper that normalised empties here would make a cleared
    // control silently un-clearable. `toBe('')`, not a truthiness check, for that reason.
    const { service, sent } = recordingClient();

    await service.update('app_1', { interviewDate: '' }, 3);

    const { body } = soleRequest(sent);
    expect('interviewDate' in body).toBe(true);
    expect(body.interviewDate).toBe('');
  });

  it('maps the field back off a response', async () => {
    const { service } = recordingClient(apiApplication({ interviewDate: INSTANT }));

    const application = await service.update('app_1', {}, 3);

    expect(application.interviewDate).toBe(INSTANT);
  });

  it('normalises the API `null` to `undefined` on the way in', async () => {
    // The API sends an explicit `null` for an unscheduled interview, and `Application`
    // declares `string | undefined`. Left as `null` the value would be falsy everywhere it is
    // *read*, and would still reach the edit form's prefill as a non-undefined value.
    const { service } = recordingClient(apiApplication({ interviewDate: null }));

    const application = await service.update('app_1', {}, 3);

    expect(application.interviewDate).toBeUndefined();
  });
});
