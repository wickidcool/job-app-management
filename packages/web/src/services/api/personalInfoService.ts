import type { APIClient } from './apiClient';
import type { GetPersonalInfoResponse, UpdatePersonalInfoRequest } from './types';

/**
 * Personal Information Service
 */
export class PersonalInfoService {
  private readonly client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  /**
   * Get personal information
   * Creates a default record if none exists
   */
  async get(): Promise<GetPersonalInfoResponse> {
    return this.client.get<GetPersonalInfoResponse>('/personal-info');
  }

  /**
   * Update personal information
   * Creates a record if none exists (upsert behavior)
   */
  async update(data: UpdatePersonalInfoRequest): Promise<GetPersonalInfoResponse> {
    return this.client.patch<GetPersonalInfoResponse>('/personal-info', data);
  }
}

/**
 * Create personal info service instance
 */
export function createPersonalInfoService(client: APIClient): PersonalInfoService {
  return new PersonalInfoService(client);
}
