import type { APIClient } from './apiClient';

export interface Project {
  id: string;
  name: string;
  fileCount: number;
  updatedAt: Date;
}

export interface ProjectFile {
  fileName: string;
  resumeId: string;
  updatedAt: Date;
}

export interface ListProjectsResponse {
  projects: Array<{
    id: string;
    name: string;
    fileCount: number;
    updatedAt: string;
  }>;
}

export interface ListProjectFilesResponse {
  files: Array<{
    fileName: string;
    resumeId: string;
    updatedAt: string;
  }>;
}

export interface GenerateIndexResponse {
  path: string;
  projectCount: number;
}

function transformProject(apiProject: ListProjectsResponse['projects'][0]): Project {
  return {
    id: apiProject.id,
    name: apiProject.name,
    fileCount: apiProject.fileCount,
    updatedAt: new Date(apiProject.updatedAt),
  };
}

function transformProjectFile(apiFile: ListProjectFilesResponse['files'][0]): ProjectFile {
  return {
    fileName: apiFile.fileName,
    resumeId: apiFile.resumeId,
    updatedAt: new Date(apiFile.updatedAt),
  };
}

export class ProjectService {
  client: APIClient;

  constructor(client: APIClient) {
    this.client = client;
  }

  async listProjects(): Promise<Project[]> {
    const response = await this.client.get<ListProjectsResponse>('/projects');
    return response.projects.map(transformProject);
  }

  async listProjectFiles(projectId: string): Promise<ProjectFile[]> {
    const response = await this.client.get<ListProjectFilesResponse>(
      `/projects/${projectId}/files`,
    );
    return response.files.map(transformProjectFile);
  }

  async getProjectFile(projectId: string, fileName: string): Promise<string> {
    return await this.client.get<string>(`/projects/${projectId}/files/${fileName}`);
  }

  async updateProjectFile(projectId: string, fileName: string, content: string): Promise<void> {
    await this.client.put(`/projects/${projectId}/files/${fileName}`, { content });
  }

  async generateIndex(): Promise<GenerateIndexResponse> {
    return await this.client.post<GenerateIndexResponse>('/projects/generate-index', {});
  }
}

export function createProjectService(client: APIClient): ProjectService {
  return new ProjectService(client);
}
