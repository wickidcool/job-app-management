import type { APIClient } from './apiClient';
import type { PersonalInfo, GetPersonalInfoResponse, UpdatePersonalInfoRequest } from './types';

/**
 * Personal Information Service
 */
export class PersonalInfoService {
  client: APIClient;

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

  /**
   * Reset personal information to empty state
   */
  async reset(): Promise<{ personalInfo: PersonalInfo }> {
    return this.client.delete<{ personalInfo: PersonalInfo }>('/personal-info');
  }

  /**
   * Export personal information as vCard
   */
  async exportVCard(): Promise<Blob> {
    const response = await fetch(`${this.client.baseURL}/personal-info/export/vcard`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${await this.client.getAuthToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to export vCard');
    }

    return response.blob();
  }
}

/**
 * Create personal info service instance
 */
export function createPersonalInfoService(client: APIClient): PersonalInfoService {
  return new PersonalInfoService(client);
}
