import { describe, it, expect } from 'vitest';
import { parseStatusParam, APPLICATION_STATUSES } from './applicationStatus';

describe('parseStatusParam', () => {
  it('parses the comma-separated value the command palette links with', () => {
    expect(parseStatusParam('interview,phone_screen')).toEqual(['interview', 'phone_screen']);
  });

  it('parses a single status', () => {
    expect(parseStatusParam('applied')).toEqual(['applied']);
  });

  it('returns an empty list for a missing or blank value', () => {
    expect(parseStatusParam(null)).toEqual([]);
    expect(parseStatusParam(undefined)).toEqual([]);
    expect(parseStatusParam('')).toEqual([]);
  });

  it('drops unrecognised tokens rather than forwarding them to the API', () => {
    expect(parseStatusParam('interview,not_a_status')).toEqual(['interview']);
    expect(parseStatusParam('nonsense')).toEqual([]);
  });

  it('tolerates surrounding whitespace and de-duplicates', () => {
    expect(parseStatusParam(' interview , interview ,offer')).toEqual(['interview', 'offer']);
  });

  it('accepts every status the app defines', () => {
    expect(parseStatusParam(APPLICATION_STATUSES.join(','))).toEqual(APPLICATION_STATUSES);
  });
});
