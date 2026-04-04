const BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message: string }).message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface ProjectMeta { slug: string; name: string; size: number; mtime: string }
export interface ProjectContent { slug: string; content: string }
export interface ParsedResume { sections: ResumeSection[]; rawText: string; warnings: string[] }
export interface ResumeSection { heading: string; entries: ResumeEntry[] }
export interface ResumeEntry { company: string; title: string; dates: string; bullets: string[] }
export interface MatchResult { score: number; matchedKeywords: string[]; missedKeywords: string[]; projectScores: ProjectScore[] }
export interface ProjectScore { slug: string; name: string; score: number; matchedKeywords: string[] }

export const listProjects = () => request<ProjectMeta[]>('GET', '/projects');
export const getProject = (slug: string) => request<ProjectContent>('GET', `/projects/${slug}`);
export const createProject = (name: string, content: string) => request<{ slug: string; name: string }>('POST', '/projects', { name, content });
export const updateProject = (slug: string, content: string) => request<{ slug: string }>('PUT', `/projects/${slug}`, { content });
export const deleteProject = (slug: string) => request<void>('DELETE', `/projects/${slug}`);

export async function uploadMarkdown(file: File): Promise<{ slug: string; name: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/api/v1/projects/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message: string }).message ?? res.statusText);
  }
  return res.json();
}

export async function parseResume(file: File): Promise<ParsedResume> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/api/v1/resume/parse`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error((err as { message: string }).message ?? res.statusText);
  }
  return res.json();
}

export const getIndex = () => request<{ content: string }>('GET', '/index');
export const regenerateIndex = () => request<{ content: string }>('POST', '/index/regenerate');
export const aiUpdateProject = (slug: string, instruction: string) => request<{ slug: string; content: string }>('POST', `/ai/update/${slug}`, { instruction });
export const generateCoverLetter = (jobDescription: string, additionalContext?: string) => request<{ coverLetter: string }>('POST', '/ai/cover-letter', { jobDescription, additionalContext });
export const matchJobDescription = (jobDescription: string) => request<MatchResult>('POST', '/match', { jobDescription });
