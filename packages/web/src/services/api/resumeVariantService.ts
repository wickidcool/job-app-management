import type { APIClient } from './apiClient';
import type {
  GenerateResumeVariantRequest,
  GenerateResumeVariantResponse,
  ReviseResumeVariantRequest,
  ReviseResumeVariantResponse,
  UpdateResumeVariantRequest,
  ListResumeVariantsResponse,
  GetResumeVariantResponse,
  SuggestBulletsRequest,
  SuggestBulletsResponse,
  ExportResumeVariantRequest,
  ExportResumeVariantResponse,
  ResumeVariant,
  ResumeFormat,
} from './types';

export class ResumeVariantService {
  client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  async generate(request: GenerateResumeVariantRequest): Promise<GenerateResumeVariantResponse> {
    const response = await this.client.post<GenerateResumeVariantResponse>(
      '/resume-variants/generate',
      request
    );
    return response;
  }

  async list(params?: {
    status?: 'draft' | 'finalized';
    company?: string;
    search?: string;
    format?: ResumeFormat;
    limit?: number;
    cursor?: string;
  }): Promise<ListResumeVariantsResponse> {
    const response = await this.client.get<ListResumeVariantsResponse>('/resume-variants', params);
    return response;
  }

  async getById(id: string): Promise<GetResumeVariantResponse> {
    const response = await this.client.get<GetResumeVariantResponse>(`/resume-variants/${id}`);
    return response;
  }

  async update(id: string, request: UpdateResumeVariantRequest): Promise<ResumeVariant> {
    const response = await this.client.patch<{ variant: ResumeVariant }>(
      `/resume-variants/${id}`,
      request
    );
    return response.variant;
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/resume-variants/${id}`);
  }

  async revise(id: string, request: ReviseResumeVariantRequest): Promise<ReviseResumeVariantResponse> {
    const response = await this.client.post<ReviseResumeVariantResponse>(
      `/resume-variants/${id}/revise`,
      request
    );
    return response;
  }

  async suggestBullets(request: SuggestBulletsRequest): Promise<SuggestBulletsResponse> {
    const response = await this.client.post<SuggestBulletsResponse>(
      '/resume-variants/suggest-bullets',
      request
    );
    return response;
  }

  async export(id: string, request: ExportResumeVariantRequest): Promise<ExportResumeVariantResponse> {
    const response = await this.client.post<ExportResumeVariantResponse>(
      `/resume-variants/${id}/export`,
      request
    );
    return response;
  }
}

export function createResumeVariantService(client: APIClient): ResumeVariantService {
  return new ResumeVariantService(client);
}
