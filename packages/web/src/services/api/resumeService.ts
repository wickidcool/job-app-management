import type { APIClient } from './apiClient';
import type { APIResume, ListResumesResponse } from './types';

export interface Resume {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
  version: number;
}

function transformAPIResume(apiResume: APIResume): Resume {
  return {
    id: apiResume.id,
    fileName: apiResume.fileName,
    fileSize: apiResume.fileSize,
    mimeType: apiResume.mimeType,
    uploadedAt: new Date(apiResume.uploadedAt),
    version: apiResume.version,
  };
}

export class ResumeService {
  client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  async getAll(): Promise<Resume[]> {
    const response = await this.client.get<ListResumesResponse>('/resumes');
    return response.resumes.map(transformAPIResume);
  }
}

export function createResumeService(client: APIClient): ResumeService {
  return new ResumeService(client);
}
