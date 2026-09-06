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
    contact: apiApp.contact,
    compTarget: apiApp.compTarget,
    nextAction: apiApp.nextAction,
    nextActionDue: apiApp.nextActionDue,
    // `?? undefined` rather than a passthrough: the API sends an explicit `null` for an
    // unscheduled interview and `Application.interviewDate` is `string | undefined`.
    // Normalising at the boundary keeps "no interview" a single value on the client side.
    // WIC-2188.
    interviewDate: apiApp.interviewDate ?? undefined,
  };
}

/**
 * Page size requested from the API. `GET /api/applications` caps `limit` at 100
 * (`packages/api/src/routes/applications.ts`), so this is the largest legal page.
 */
export const APPLICATION_PAGE_SIZE = 100;

/**
 * Hard bound on how many pages `getAllPaged` will follow. At the maximum page
 * size this is 5,000 applications — far beyond any realistic account, but it
 * stops a bad `nextPage` cursor from looping forever. Hitting it sets
 * `truncated`, which callers must surface rather than swallow.
 */
export const MAX_APPLICATION_PAGES = 50;

/**
 * A complete (or explicitly-incomplete) set of applications for a filter.
 */
export interface ApplicationCollection {
  applications: Application[];
  /** Rows the server reports for this filter, independent of how many were fetched. */
  totalCount: number;
  /**
   * True when pagination stopped at `MAX_APPLICATION_PAGES` with a `nextPage`
   * cursor still outstanding — i.e. `applications` is a prefix, not the whole set.
   * Callers must render this rather than presenting a partial view as complete.
   */
  truncated: boolean;
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

  private buildListQuery(
    filters?: { status?: string[]; company?: string; search?: string },
    page?: string
  ): string {
    const params = new URLSearchParams();

    if (filters?.status && filters.status.length > 0) {
      params.append('status', filters.status.join(','));
    }

    if (filters?.company) {
      params.append('company', filters.company);
    }

    if (filters?.search) {
      params.append('search', filters.search);
    }

    params.append('limit', String(APPLICATION_PAGE_SIZE));

    if (page) {
      params.append('page', page);
    }

    return `/applications?${params.toString()}`;
  }

  /**
   * Get all applications, following `nextPage` to exhaustion.
   *
   * The API pages this endpoint (default 50, max 100) ordered by most-recently
   * updated. Reading only the first page silently drops every older row, which
   * is fatal for any caller asking an "oldest"/"how many in total" question.
   * This follows the cursor instead, and reports via `truncated` when it could
   * not finish rather than returning a partial set that looks complete.
   */
  async getAllPaged(filters?: {
    status?: string[];
    company?: string;
    search?: string;
  }): Promise<ApplicationCollection> {
    const applications: Application[] = [];
    let page: string | undefined;
    let totalCount = 0;
    let truncated = false;

    for (let fetched = 0; fetched < MAX_APPLICATION_PAGES; fetched++) {
      const response = await this.client.get<ListApplicationsResponse>(
        this.buildListQuery(filters, page)
      );

      applications.push(...response.applications.map(transformAPIApplication));
      totalCount = response.totalCount ?? applications.length;
      page = response.nextPage;

      if (!page) {
        return { applications, totalCount, truncated };
      }
    }

    // Ran out of page budget with a cursor still outstanding.
    truncated = true;
    return { applications, totalCount, truncated };
  }

  /**
   * Get all applications.
   *
   * Convenience wrapper over {@link getAllPaged} for callers that only need the
   * rows. Callers that render a count or a "nothing needs attention" conclusion
   * should use `getAllPaged` (or the dashboard aggregates) so they can tell a
   * complete answer from a partial one.
   */
  async getAll(filters?: {
    status?: string[];
    company?: string;
    search?: string;
  }): Promise<Application[]> {
    const { applications } = await this.getAllPaged(filters);
    return applications;
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
      contact: data.contact,
      compTarget: data.compTarget,
      nextAction: data.nextAction,
      nextActionDue: data.nextActionDue,
      interviewDate: data.interviewDate,
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
      contact: data.contact,
      compTarget: data.compTarget,
      nextAction: data.nextAction,
      nextActionDue: data.nextActionDue,
      // Forwarded verbatim, including `''`. That is not sloppiness about empty strings: `''`
      // is the *clear* request and `undefined` is the leave-alone request, and collapsing
      // them here would make a cleared interview date silently un-clearable. WIC-2188.
      interviewDate: data.interviewDate,
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
    const response = await this.client.post<{ application: APIApplication }>(
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
