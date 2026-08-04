import type { APIClient } from './apiClient';
import type { APIResume, ListResumesResponse } from './types';
import { getSessionId } from '../analytics';

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

  async upload(file: File): Promise<Resume> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.client.request<APIResume>('/resumes/upload', {
      method: 'POST',
      body: formData,
      headers: {
        // Don't set Content-Type - let browser set it with multipart boundary.
        // Correlate this upload with the server-side resume_upload_* events
        // (WIC-814): the backend reads X-Session-Id and stamps it onto them.
        'X-Session-Id': getSessionId(),
      },
    });
    return transformAPIResume(response);
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(`/resumes/${id}`);
  }
}

export function createResumeService(client: APIClient): ResumeService {
  return new ResumeService(client);
}
