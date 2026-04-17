import { ApplicationStatus } from '../types/entities';
import { CreateApplicationRequest, UpdateApplicationRequest, UpdateStatusRequest } from '../types/api';

export const ALL_STATUSES: ApplicationStatus[] = [
  'saved',
  'applied',
  'phone_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
];

export const VALID_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  saved: ['applied', 'withdrawn'],
  applied: ['phone_screen', 'rejected', 'withdrawn'],
  phone_screen: ['interview', 'rejected', 'withdrawn'],
  interview: ['offer', 'rejected', 'withdrawn'],
  offer: [],
  rejected: [],
  withdrawn: [],
};

export function isValidStatus(value: unknown): value is ApplicationStatus {
  return typeof value === 'string' && ALL_STATUSES.includes(value as ApplicationStatus);
}

export function isValidTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateCreateRequest(body: unknown): {
  data?: CreateApplicationRequest;
  errors?: ValidationError[];
} {
  const errors: ValidationError[] = [];

  if (!body || typeof body !== 'object') {
    return { errors: [{ field: 'body', message: 'Request body is required' }] };
  }

  const b = body as Record<string, unknown>;

  if (!b.jobTitle || typeof b.jobTitle !== 'string' || b.jobTitle.trim().length === 0) {
    errors.push({ field: 'jobTitle', message: 'jobTitle is required' });
  } else if (b.jobTitle.length > 200) {
    errors.push({ field: 'jobTitle', message: 'jobTitle must be 200 characters or less' });
  }

  if (!b.company || typeof b.company !== 'string' || b.company.trim().length === 0) {
    errors.push({ field: 'company', message: 'company is required' });
  } else if (b.company.length > 200) {
    errors.push({ field: 'company', message: 'company must be 200 characters or less' });
  }

  if (b.url !== undefined && b.url !== null) {
    if (typeof b.url !== 'string') {
      errors.push({ field: 'url', message: 'url must be a string' });
    } else {
      try {
        new URL(b.url);
      } catch {
        errors.push({ field: 'url', message: 'url must be a valid URL' });
      }
    }
  }

  if (b.location !== undefined && (typeof b.location !== 'string' || b.location.length > 100)) {
    errors.push({ field: 'location', message: 'location must be a string of 100 characters or less' });
  }

  if (b.salaryRange !== undefined && (typeof b.salaryRange !== 'string' || b.salaryRange.length > 50)) {
    errors.push({ field: 'salaryRange', message: 'salaryRange must be a string of 50 characters or less' });
  }

  if (b.status !== undefined && !isValidStatus(b.status)) {
    errors.push({ field: 'status', message: `status must be one of: ${ALL_STATUSES.join(', ')}` });
  }

  if (errors.length > 0) return { errors };

  return {
    data: {
      jobTitle: (b.jobTitle as string).trim(),
      company: (b.company as string).trim(),
      url: b.url as string | undefined,
      location: b.location as string | undefined,
      salaryRange: b.salaryRange as string | undefined,
      status: (b.status as ApplicationStatus | undefined) ?? 'saved',
      coverLetterId: b.coverLetterId as string | undefined,
      resumeVersionId: b.resumeVersionId as string | undefined,
    },
  };
}

export function validateUpdateRequest(body: unknown): {
  data?: UpdateApplicationRequest;
  errors?: ValidationError[];
} {
  const errors: ValidationError[] = [];

  if (!body || typeof body !== 'object') {
    return { errors: [{ field: 'body', message: 'Request body is required' }] };
  }

  const b = body as Record<string, unknown>;

  if (b.version === undefined || typeof b.version !== 'number') {
    errors.push({ field: 'version', message: 'version is required and must be a number' });
  }

  if (b.jobTitle !== undefined && (typeof b.jobTitle !== 'string' || b.jobTitle.trim().length === 0)) {
    errors.push({ field: 'jobTitle', message: 'jobTitle must be a non-empty string' });
  }

  if (b.company !== undefined && (typeof b.company !== 'string' || b.company.trim().length === 0)) {
    errors.push({ field: 'company', message: 'company must be a non-empty string' });
  }

  if (errors.length > 0) return { errors };

  return {
    data: {
      jobTitle: b.jobTitle as string | undefined,
      company: b.company as string | undefined,
      url: b.url as string | null | undefined,
      location: b.location as string | null | undefined,
      salaryRange: b.salaryRange as string | null | undefined,
      coverLetterId: b.coverLetterId as string | null | undefined,
      resumeVersionId: b.resumeVersionId as string | null | undefined,
      version: b.version as number,
    },
  };
}

export function validateStatusRequest(body: unknown): {
  data?: UpdateStatusRequest;
  errors?: ValidationError[];
} {
  const errors: ValidationError[] = [];

  if (!body || typeof body !== 'object') {
    return { errors: [{ field: 'body', message: 'Request body is required' }] };
  }

  const b = body as Record<string, unknown>;

  if (!isValidStatus(b.status)) {
    errors.push({ field: 'status', message: `status must be one of: ${ALL_STATUSES.join(', ')}` });
  }

  if (b.version === undefined || typeof b.version !== 'number') {
    errors.push({ field: 'version', message: 'version is required and must be a number' });
  }

  if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 500)) {
    errors.push({ field: 'note', message: 'note must be a string of 500 characters or less' });
  }

  if (errors.length > 0) return { errors };

  return {
    data: {
      status: b.status as ApplicationStatus,
      note: b.note as string | undefined,
      version: b.version as number,
    },
  };
}
