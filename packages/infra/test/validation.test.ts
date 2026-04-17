import {
  validateCreateRequest,
  validateUpdateRequest,
  validateStatusRequest,
  isValidTransition,
  VALID_TRANSITIONS,
} from '../src/utils/validation';

describe('validateCreateRequest', () => {
  it('accepts a minimal valid request', () => {
    const { data, errors } = validateCreateRequest({ jobTitle: 'Engineer', company: 'Acme' });
    expect(errors).toBeUndefined();
    expect(data).toMatchObject({ jobTitle: 'Engineer', company: 'Acme', status: 'saved' });
  });

  it('requires jobTitle', () => {
    const { errors } = validateCreateRequest({ company: 'Acme' });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'jobTitle' })]));
  });

  it('requires company', () => {
    const { errors } = validateCreateRequest({ jobTitle: 'Engineer' });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'company' })]));
  });

  it('rejects invalid URL', () => {
    const { errors } = validateCreateRequest({ jobTitle: 'Eng', company: 'Acme', url: 'not-a-url' });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'url' })]));
  });

  it('accepts a valid URL', () => {
    const { errors } = validateCreateRequest({
      jobTitle: 'Eng',
      company: 'Acme',
      url: 'https://example.com/jobs/123',
    });
    expect(errors).toBeUndefined();
  });

  it('rejects invalid status', () => {
    const { errors } = validateCreateRequest({ jobTitle: 'Eng', company: 'Acme', status: 'flying' });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'status' })]));
  });

  it('trims whitespace from jobTitle and company', () => {
    const { data } = validateCreateRequest({ jobTitle: '  Engineer  ', company: '  Acme  ' });
    expect(data?.jobTitle).toBe('Engineer');
    expect(data?.company).toBe('Acme');
  });

  it('returns error for non-object body', () => {
    const { errors } = validateCreateRequest('string');
    expect(errors).toBeDefined();
  });
});

describe('validateUpdateRequest', () => {
  it('requires version', () => {
    const { errors } = validateUpdateRequest({ jobTitle: 'New Title' });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'version' })]));
  });

  it('accepts a valid update with version', () => {
    const { data, errors } = validateUpdateRequest({ jobTitle: 'New Title', version: 2 });
    expect(errors).toBeUndefined();
    expect(data?.version).toBe(2);
    expect(data?.jobTitle).toBe('New Title');
  });

  it('accepts null fields for clearing', () => {
    const { data, errors } = validateUpdateRequest({ url: null, version: 1 });
    expect(errors).toBeUndefined();
    expect(data?.url).toBeNull();
  });
});

describe('validateStatusRequest', () => {
  it('requires status', () => {
    const { errors } = validateStatusRequest({ version: 1 });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'status' })]));
  });

  it('requires version', () => {
    const { errors } = validateStatusRequest({ status: 'applied' });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'version' })]));
  });

  it('accepts a valid status update', () => {
    const { data, errors } = validateStatusRequest({ status: 'applied', version: 1 });
    expect(errors).toBeUndefined();
    expect(data?.status).toBe('applied');
    expect(data?.version).toBe(1);
  });

  it('rejects invalid status', () => {
    const { errors } = validateStatusRequest({ status: 'bogus', version: 1 });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'status' })]));
  });

  it('validates note length', () => {
    const longNote = 'x'.repeat(501);
    const { errors } = validateStatusRequest({ status: 'applied', version: 1, note: longNote });
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'note' })]));
  });
});

describe('isValidTransition', () => {
  it('allows saved → applied', () => {
    expect(isValidTransition('saved', 'applied')).toBe(true);
  });

  it('allows saved → withdrawn', () => {
    expect(isValidTransition('saved', 'withdrawn')).toBe(true);
  });

  it('disallows saved → interview (skip stages)', () => {
    expect(isValidTransition('saved', 'interview')).toBe(false);
  });

  it('disallows offer → applied (backwards)', () => {
    expect(isValidTransition('offer', 'applied')).toBe(false);
  });

  it('disallows any transition from terminal states', () => {
    for (const terminal of ['offer', 'rejected', 'withdrawn'] as const) {
      const targets = VALID_TRANSITIONS[terminal];
      expect(targets).toHaveLength(0);
    }
  });

  it('allows full happy path: saved → applied → phone_screen → interview → offer', () => {
    expect(isValidTransition('saved', 'applied')).toBe(true);
    expect(isValidTransition('applied', 'phone_screen')).toBe(true);
    expect(isValidTransition('phone_screen', 'interview')).toBe(true);
    expect(isValidTransition('interview', 'offer')).toBe(true);
  });

  it('allows rejection from any active state', () => {
    for (const status of ['applied', 'phone_screen', 'interview'] as const) {
      expect(isValidTransition(status, 'rejected')).toBe(true);
    }
  });
});
