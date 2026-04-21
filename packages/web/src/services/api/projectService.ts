import type { APIClient } from './apiClient';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  fileCount: number;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ProjectFile {
  fileName: string;
  size: number;
  updatedAt: Date;
}

export interface CreateProjectInput {
  name: string;
  slug?: string;
  description?: string;
}

export interface ListProjectsResponse {
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    fileCount: number;
    createdAt: string;
    updatedAt: string;
    version: number;
  }>;
}

export interface ListProjectFilesResponse {
  files: Array<{
    fileName: string;
    size: number;
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
    slug: apiProject.slug,
    description: apiProject.description,
    fileCount: apiProject.fileCount,
    createdAt: new Date(apiProject.createdAt),
    updatedAt: new Date(apiProject.updatedAt),
    version: apiProject.version,
  };
}

function transformProjectFile(apiFile: ListProjectFilesResponse['files'][0]): ProjectFile {
  return {
    fileName: apiFile.fileName,
    size: apiFile.size,
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

  async createProject(input: CreateProjectInput): Promise<Project> {
    const response = await this.client.post<ListProjectsResponse['projects'][0]>('/projects', input);
    return transformProject(response);
  }

  async getProject(slug: string): Promise<Project> {
    const response = await this.client.get<ListProjectsResponse['projects'][0]>(`/projects/${slug}`);
    return transformProject(response);
  }

  async deleteProject(slug: string): Promise<void> {
    await this.client.delete(`/projects/${slug}`);
  }

  async listProjectFiles(slug: string): Promise<ProjectFile[]> {
    const response = await this.client.get<ListProjectFilesResponse>(
      `/projects/${slug}/files`,
    );
    return response.files.map(transformProjectFile);
  }

  async getProjectFile(slug: string, fileName: string): Promise<string> {
    const response = await this.client.get<{ content: string }>(
      `/projects/${slug}/files/${fileName}`,
    );
    return response.content;
  }

  async updateProjectFile(slug: string, fileName: string, content: string): Promise<void> {
    await this.client.put(`/projects/${slug}/files/${fileName}`, { content });
  }

  async createProjectFile(slug: string, fileName: string, content: string): Promise<void> {
    await this.client.post(`/projects/${slug}/files`, { fileName, content });
  }

  async deleteProjectFile(slug: string, fileName: string): Promise<void> {
    await this.client.delete(`/projects/${slug}/files/${fileName}`);
  }

  async generateIndex(): Promise<GenerateIndexResponse> {
    return await this.client.post<GenerateIndexResponse>('/projects/generate-index', {});
  }
}

export function createProjectService(client: APIClient): ProjectService {
  return new ProjectService(client);
}
