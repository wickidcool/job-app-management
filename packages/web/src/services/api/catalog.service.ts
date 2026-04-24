import { apiClient } from './apiClient';
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

export const catalogService = {
  /**
   * Generate a diff after resume upload or application creation
   */
  async generateDiff(params: {
    sourceType: 'resume' | 'application';
    sourceId: string;
  }): Promise<CatalogDiff> {
    const response = await apiClient.post<CatalogDiff>(
      '/api/catalog/generate-diff',
      params
    );
    return response.data;
  },

  /**
   * Get a specific catalog diff by ID
   */
  async getDiff(diffId: string): Promise<CatalogDiff> {
    const response = await apiClient.get<CatalogDiff>(
      `/api/catalog/diffs/${diffId}`
    );
    return response.data;
  },

  /**
   * List all pending diffs
   */
  async listDiffs(): Promise<CatalogDiff[]> {
    const response = await apiClient.get<CatalogDiff[]>(
      '/api/catalog/diffs'
    );
    return response.data;
  },

  /**
   * Apply selected changes from a diff
   */
  async applyDiff(
    diffId: string,
    request: ApplyDiffRequest
  ): Promise<ApplyDiffResponse> {
    const response = await apiClient.post<ApplyDiffResponse>(
      `/api/catalog/diffs/${diffId}/apply`,
      request
    );
    return response.data;
  },

  /**
   * Discard a pending diff
   */
  async discardDiff(diffId: string): Promise<void> {
    await apiClient.delete(`/api/catalog/diffs/${diffId}`);
  },

  /**
   * Get companies from catalog
   */
  async getCompanies(params?: {
    search?: string;
    sort?: string;
  }): Promise<CompanyCatalogEntry[]> {
    const response = await apiClient.get<CompanyCatalogEntry[]>(
      '/api/catalog/companies',
      { params }
    );
    return response.data;
  },

  /**
   * Get tech stack tags from catalog
   */
  async getTechStackTags(params?: {
    category?: string;
    search?: string;
    sort?: string;
  }): Promise<TechStackTag[]> {
    const response = await apiClient.get<TechStackTag[]>(
      '/api/catalog/tags/tech-stack',
      { params }
    );
    return response.data;
  },

  /**
   * Get job fit tags from catalog
   */
  async getJobFitTags(params?: {
    category?: string;
    search?: string;
    sort?: string;
  }): Promise<JobFitTag[]> {
    const response = await apiClient.get<JobFitTag[]>(
      '/api/catalog/tags/job-fit',
      { params }
    );
    return response.data;
  },

  /**
   * Get quantified bullets from catalog
   */
  async getQuantifiedBullets(params?: {
    impact?: string;
    search?: string;
    sort?: string;
  }): Promise<QuantifiedBullet[]> {
    const response = await apiClient.get<QuantifiedBullet[]>(
      '/api/catalog/quantified-bullets',
      { params }
    );
    return response.data;
  },
};
