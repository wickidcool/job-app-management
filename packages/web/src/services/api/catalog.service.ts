import type { APIClient } from './apiClient';
import type {
  CatalogDiff,
  ApplyDiffRequest,
  ApplyDiffResponse,
  CompanyCatalogEntry,
  TechStackTag,
  JobFitTag,
  QuantifiedBullet,
} from '../../types/catalog';
import type { CatalogEntry } from './types';

/**
 * Catalog API service for UC-2 Catalog Diff Review
 */
export interface CatalogService {
  generateDiff(params: {
    sourceType: 'resume' | 'application';
    sourceId: string;
  }): Promise<CatalogDiff>;
  getDiff(diffId: string): Promise<CatalogDiff>;
  listDiffs(): Promise<CatalogDiff[]>;
  applyDiff(diffId: string, request: ApplyDiffRequest): Promise<ApplyDiffResponse>;
  discardDiff(diffId: string): Promise<void>;
  getCompanies(params?: { search?: string; sort?: string }): Promise<CompanyCatalogEntry[]>;
  getTechStackTags(params?: {
    category?: string;
    search?: string;
    sort?: string;
  }): Promise<TechStackTag[]>;
  getJobFitTags(params?: {
    category?: string;
    search?: string;
    sort?: string;
  }): Promise<JobFitTag[]>;
  getQuantifiedBullets(params?: {
    impact?: string;
    search?: string;
    sort?: string;
  }): Promise<QuantifiedBullet[]>;
  /** Scored against a stored job-fit analysis when `jobFitAnalysisId` is supplied (WIC-1820). */
  getStarEntries(jobFitAnalysisId?: string): Promise<CatalogEntry[]>;
}

export function createCatalogService(client: APIClient): CatalogService {
  return {
    /**
     * Generate a diff after resume upload or application creation
     */
    async generateDiff(params: {
      sourceType: 'resume' | 'application';
      sourceId: string;
    }): Promise<CatalogDiff> {
      return client.post<CatalogDiff>('/catalog/generate-diff', params);
    },

    /**
     * Get a specific catalog diff by ID
     */
    async getDiff(diffId: string): Promise<CatalogDiff> {
      return client.get<CatalogDiff>(`/catalog/diffs/${diffId}`);
    },

    /**
     * List all pending diffs
     */
    async listDiffs(): Promise<CatalogDiff[]> {
      const response = await client.get<{ diffs: CatalogDiff[]; nextCursor?: string }>(
        '/catalog/diffs'
      );
      return response.diffs;
    },

    /**
     * Apply selected changes from a diff
     */
    async applyDiff(diffId: string, request: ApplyDiffRequest): Promise<ApplyDiffResponse> {
      return client.post<ApplyDiffResponse>(`/catalog/diffs/${diffId}/apply`, request);
    },

    /**
     * Discard a pending diff
     */
    async discardDiff(diffId: string): Promise<void> {
      await client.delete(`/catalog/diffs/${diffId}`);
    },

    /**
     * Get companies from catalog
     */
    async getCompanies(params?: {
      search?: string;
      sort?: string;
    }): Promise<CompanyCatalogEntry[]> {
      const response = await client.get<{
        companies: CompanyCatalogEntry[];
        nextCursor?: string;
      }>('/catalog/companies', params);
      return response.companies;
    },

    /**
     * Get tech stack tags from catalog
     */
    async getTechStackTags(params?: {
      category?: string;
      search?: string;
      sort?: string;
    }): Promise<TechStackTag[]> {
      const response = await client.get<{ tags: TechStackTag[]; nextCursor?: string }>(
        '/catalog/tags/tech-stack',
        params
      );
      return response.tags;
    },

    /**
     * Get job fit tags from catalog
     */
    async getJobFitTags(params?: {
      category?: string;
      search?: string;
      sort?: string;
    }): Promise<JobFitTag[]> {
      const response = await client.get<{ tags: JobFitTag[]; nextCursor?: string }>(
        '/catalog/tags/job-fit',
        params
      );
      return response.tags;
    },

    /**
     * Get quantified bullets from catalog
     */
    async getQuantifiedBullets(params?: {
      impact?: string;
      search?: string;
      sort?: string;
    }): Promise<QuantifiedBullet[]> {
      const response = await client.get<{ bullets: QuantifiedBullet[]; nextCursor?: string }>(
        '/catalog/quantified-bullets',
        params
      );
      return response.bullets;
    },

    /**
     * Get STAR catalog entries for cover letter generation.
     *
     * Pass `jobFitAnalysisId` to have each entry scored against a stored job-fit analysis; that
     * is what populates `relevanceScore` and so what makes `StarEntryPicker`'s "Recommended"
     * section reachable at all (WIC-1820). Omit it and every entry comes back unscored.
     *
     * An id that does not resolve — stale, or another user's — is a 422, not an empty result.
     */
    async getStarEntries(jobFitAnalysisId?: string): Promise<CatalogEntry[]> {
      const response = await client.get<{ entries: CatalogEntry[] }>(
        '/star-entries',
        jobFitAnalysisId === undefined ? undefined : { jobFitAnalysisId }
      );
      return response.entries;
    },
  };
}
