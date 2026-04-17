import type { Application, ApplicationFormData, ApplicationStatus } from '../../types/application';
import type { APIClient } from './apiClient';
import type {
  APIApplication,
  ListApplicationsResponse,
  GetApplicationResponse,
  CreateApplicationRequest,
  UpdateApplicationRequest,
} from './types';

/**
 * Transform API application (ISO strings) to app application (Date objects)
 */
function transformAPIApplication(apiApp: APIApplication): Application {
  return {
    id: apiApp.id,
    jobTitle: apiApp.jobTitle,
    company: apiApp.company,
    url: apiApp.url,
    location: apiApp.location,
    salaryRange: apiApp.salaryRange,
    jobDescription: apiApp.jobDescription,
    status: apiApp.status,
    hasDocuments: !!(apiApp.coverLetterId || apiApp.resumeVersionId),
    version: apiApp.version,
    createdAt: new Date(apiApp.createdAt),
    updatedAt: new Date(apiApp.updatedAt),
    appliedAt: apiApp.appliedAt ? new Date(apiApp.appliedAt) : undefined,
  };
}

/**
 * Application Service using real API
 * This service matches the interface of mockApplicationService
 * for easy drop-in replacement
 */
export class ApplicationService {
  client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  /**
   * Get all applications
   */
  async getAll(): Promise<Application[]> {
    const response = await this.client.get<ListApplicationsResponse>('/applications');
    return response.applications.map(transformAPIApplication);
  }

  /**
   * Get application by ID
   */
  async getById(id: string): Promise<Application | null> {
    try {
      const response = await this.client.get<GetApplicationResponse>(`/applications/${id}`);
      return transformAPIApplication(response.application);
    } catch (error) {
      // Return null for 404, throw for other errors
      if (error instanceof Error && 'status' in error && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create new application
   */
  async create(data: ApplicationFormData): Promise<Application> {
    const request: CreateApplicationRequest = {
      jobTitle: data.jobTitle,
      company: data.company,
      url: data.url,
      location: data.location,
      salaryRange: data.salaryRange,
      jobDescription: data.jobDescription,
      status: data.status,
      coverLetterId: data.coverLetterId,
    };

    const response = await this.client.post<{ application: APIApplication }>(
      '/applications',
      request
    );
    return transformAPIApplication(response.application);
  }

  /**
   * Update existing application
   */
  async update(
    id: string,
    data: Partial<ApplicationFormData>,
    version: number
  ): Promise<Application> {
    const request: UpdateApplicationRequest = {
      jobTitle: data.jobTitle,
      company: data.company,
      url: data.url,
      location: data.location,
      salaryRange: data.salaryRange,
      jobDescription: data.jobDescription,
      status: data.status,
      coverLetterId: data.coverLetterId,
      version,
    };

    const response = await this.client.patch<{ application: APIApplication }>(
      `/applications/${id}`,
      request
    );
    return transformAPIApplication(response.application);
  }

  /**
   * Update application status
   */
  async updateStatus(
    id: string,
    status: ApplicationStatus,
    version: number,
    note?: string
  ): Promise<Application> {
    const response = await this.client.patch<{ application: APIApplication }>(
      `/applications/${id}/status`,
      { status, version, note }
    );
    return transformAPIApplication(response.application);
  }

  /**
   * Delete application
   */
  async delete(id: string): Promise<void> {
    await this.client.delete(`/applications/${id}`);
  }
}

/**
 * Create application service instance
 */
export function createApplicationService(client: APIClient): ApplicationService {
  return new ApplicationService(client);
}
