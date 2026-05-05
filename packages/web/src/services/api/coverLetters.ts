import type { APIClient } from './apiClient';
import type {
  GenerateCoverLetterRequest,
  GenerateCoverLetterResponse,
  ReviseCoverLetterRequest,
  ReviseCoverLetterResponse,
  UpdateCoverLetterRequest,
  GenerateOutreachRequest,
  GenerateOutreachResponse,
  ExportCoverLetterRequest,
  ExportCoverLetterResponse,
  ListCoverLettersResponse,
  CoverLetterTone,
  CoverLetterLength,
  CoverLetterEmphasis,
} from './types';

export interface CoverLetter {
  id: string;
  title: string;
  content: string;
  tone: CoverLetterTone;
  lengthVariant: CoverLetterLength;
  emphasis: CoverLetterEmphasis;
  selectedStarEntryIds: string[];
  status: 'draft' | 'finalized';
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function transformCoverLetter(
  apiCoverLetter: GenerateCoverLetterResponse['coverLetter']
): CoverLetter {
  return {
    id: apiCoverLetter.id,
    title: apiCoverLetter.title,
    content: apiCoverLetter.content,
    tone: apiCoverLetter.tone,
    lengthVariant: apiCoverLetter.lengthVariant,
    emphasis: apiCoverLetter.emphasis ?? 'balanced',
    selectedStarEntryIds: apiCoverLetter.selectedStarEntryIds,
    status: apiCoverLetter.status,
    version: apiCoverLetter.version,
    createdAt: new Date(apiCoverLetter.createdAt),
    updatedAt: new Date(apiCoverLetter.updatedAt),
  };
}

export class CoverLetterService {
  client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  async generate(request: GenerateCoverLetterRequest): Promise<CoverLetter> {
    const response = await this.client.post<GenerateCoverLetterResponse>(
      '/cover-letters/generate',
      request
    );
    return transformCoverLetter(response.coverLetter);
  }

  async list(params?: { status?: 'draft' | 'finalized'; company?: string; search?: string }) {
    const response = await this.client.get<ListCoverLettersResponse>('/cover-letters', params);
    return response.coverLetters;
  }

  async getById(id: string): Promise<CoverLetter> {
    const response = await this.client.get<{
      coverLetter: GenerateCoverLetterResponse['coverLetter'];
    }>(`/cover-letters/${id}`);
    return transformCoverLetter(response.coverLetter);
  }

  async update(id: string, request: UpdateCoverLetterRequest): Promise<CoverLetter> {
    const response = await this.client.patch<{
      coverLetter: GenerateCoverLetterResponse['coverLetter'];
    }>(`/cover-letters/${id}`, request);
    return transformCoverLetter(response.coverLetter);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/cover-letters/${id}`);
  }

  async revise(id: string, request: ReviseCoverLetterRequest): Promise<CoverLetter> {
    const response = await this.client.post<ReviseCoverLetterResponse>(
      `/cover-letters/${id}/revise`,
      request
    );
    return transformCoverLetter(response.coverLetter);
  }

  async generateOutreach(request: GenerateOutreachRequest) {
    const response = await this.client.post<GenerateOutreachResponse>(
      '/cover-letters/outreach',
      request
    );
    return response.message;
  }

  async export(id: string, request: ExportCoverLetterRequest) {
    const response = await this.client.post<ExportCoverLetterResponse>(
      `/cover-letters/${id}/export`,
      request
    );
    return response;
  }
}

export function createCoverLetterService(client: APIClient): CoverLetterService {
  return new CoverLetterService(client);
}
