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
      return client.get<CatalogDiff[]>('/catalog/diffs');
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
      return client.get<CompanyCatalogEntry[]>('/catalog/companies', params);
    },

    /**
     * Get tech stack tags from catalog
     */
    async getTechStackTags(params?: {
      category?: string;
      search?: string;
      sort?: string;
    }): Promise<TechStackTag[]> {
      return client.get<TechStackTag[]>('/catalog/tags/tech-stack', params);
    },

    /**
     * Get job fit tags from catalog
     */
    async getJobFitTags(params?: {
      category?: string;
      search?: string;
      sort?: string;
    }): Promise<JobFitTag[]> {
      return client.get<JobFitTag[]>('/catalog/tags/job-fit', params);
    },

    /**
     * Get quantified bullets from catalog
     */
    async getQuantifiedBullets(params?: {
      impact?: string;
      search?: string;
      sort?: string;
    }): Promise<QuantifiedBullet[]> {
      return client.get<QuantifiedBullet[]>('/catalog/quantified-bullets', params);
    },
  };
}
