import type { APIClient } from './apiClient';
import type {
  APIResume,
  APIResumeExport,
  ListResumeExportsResponse,
  ListResumesResponse,
} from './types';
import type { ExportFormat, ResumeExport } from '../../types/resume';
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

/**
 * `resume_exports.export_type` is a free-form column whose only writer today is
 * `'star_markdown'` (resume.service.ts). Map it onto the format the list renders,
 * treating anything unrecognised as markdown rather than throwing a row away.
 */
function exportFormatFromType(exportType: string): ExportFormat {
  if (exportType.includes('pdf')) return 'pdf';
  if (exportType.includes('docx')) return 'docx';
  return 'markdown';
}

/**
 * The table stores a `filePath`, not a display name, so derive the name from the
 * file's basename (works for both local paths and R2 object keys).
 */
function exportDisplayName(apiExport: APIResumeExport): string {
  const basename = apiExport.filePath.split(/[\\/]/).pop();
  return basename && basename.length > 0 ? basename : `Export ${apiExport.id}`;
}

function transformAPIResumeExport(apiExport: APIResumeExport): ResumeExport {
  return {
    id: apiExport.id,
    resumeId: apiExport.resumeId,
    name: exportDisplayName(apiExport),
    createdAt: new Date(apiExport.generatedAt),
    format: exportFormatFromType(apiExport.exportType),
    // fileSize and experienceIds are intentionally omitted: the row carries
    // neither. See APIResumeExport — metadata.charCount is a source-text length,
    // not a file size, and must not be substituted here.
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

  /** Exports for one resume — `GET /resumes/:resumeId/exports`. */
  async listExports(resumeId: string): Promise<ResumeExport[]> {
    const response = await this.client.get<ListResumeExportsResponse>(
      `/resumes/${encodeURIComponent(resumeId)}/exports`
    );
    return response.exports.map(transformAPIResumeExport);
  }

  /**
   * Every export the user has, newest first.
   *
   * The API exposes no all-resumes export collection, so this fans out over
   * `GET /resumes`. Bounded by the user's resume count (single digits in
   * practice) and cached by the caller's query, but it is N+1 — prefer
   * `listExports` whenever a resume id is in hand.
   */
  async listAllExports(): Promise<ResumeExport[]> {
    const resumes = await this.getAll();
    const perResume = await Promise.all(resumes.map((resume) => this.listExports(resume.id)));
    return perResume.flat().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

export function createResumeService(client: APIClient): ResumeService {
  return new ResumeService(client);
}
