import { describe, it, expect } from 'vitest';
import {
  isValidTransition,
  getValidNextStatuses,
  ALL_STATUSES,
} from '../src/services/status.service.js';

describe('isValidTransition', () => {
  it('allows saved → applied', () => {
    expect(isValidTransition('saved', 'applied')).toBe(true);
  });

  it('allows saved → withdrawn', () => {
    expect(isValidTransition('saved', 'withdrawn')).toBe(true);
  });

  it('rejects saved → interview (skipping steps)', () => {
    expect(isValidTransition('saved', 'interview')).toBe(false);
  });

  it('rejects saved → offer', () => {
    expect(isValidTransition('saved', 'offer')).toBe(false);
  });

  it('allows applied → phone_screen', () => {
    expect(isValidTransition('applied', 'phone_screen')).toBe(true);
  });

  it('allows applied → rejected', () => {
    expect(isValidTransition('applied', 'rejected')).toBe(true);
  });

  it('allows phone_screen → interview', () => {
    expect(isValidTransition('phone_screen', 'interview')).toBe(true);
  });

  it('allows interview → offer', () => {
    expect(isValidTransition('interview', 'offer')).toBe(true);
  });

  it('allows interview → rejected', () => {
    expect(isValidTransition('interview', 'rejected')).toBe(true);
  });

  it('rejects offer → anything (terminal)', () => {
    for (const status of ALL_STATUSES) {
      if (status !== 'offer') {
        expect(isValidTransition('offer', status)).toBe(false);
      }
    }
  });

  it('rejects rejected → anything (terminal)', () => {
    for (const status of ALL_STATUSES) {
      if (status !== 'rejected') {
        expect(isValidTransition('rejected', status)).toBe(false);
      }
    }
  });

  it('rejects withdrawn → anything (terminal)', () => {
    for (const status of ALL_STATUSES) {
      if (status !== 'withdrawn') {
        expect(isValidTransition('withdrawn', status)).toBe(false);
      }
    }
  });
});

describe('getValidNextStatuses', () => {
  it('returns correct transitions for saved', () => {
    expect(getValidNextStatuses('saved')).toEqual(['applied', 'withdrawn']);
  });

  it('returns empty array for terminal states', () => {
    expect(getValidNextStatuses('offer')).toEqual([]);
    expect(getValidNextStatuses('rejected')).toEqual([]);
    expect(getValidNextStatuses('withdrawn')).toEqual([]);
  });
});
